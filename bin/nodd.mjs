#!/usr/bin/env node
// Nodd CLI: end-to-end Supabase setup for the nodd package.
//
// Commands:
//   init              create+configure a Supabase project, apply migrations,
//                     write .env.local + .nodd/config.json, print snippet.
//   add-origin <url>  append a deploy URL to the auth redirect allowlist.
//
// Auth: reads SUPABASE_ACCESS_TOKEN env var. Generate at
// https://supabase.com/dashboard/account/tokens

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';

const API = 'https://api.supabase.com/v1';
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(PKG_DIR, 'supabase', 'migrations');
const MIGRATION_FILES = [
  '0001_nodd_init.sql',
  '0002_bootstrap.sql',
  '0003_realtime_delete_identity.sql',
  '0004_public_reads.sql',
  '0005_atomic_thread_create.sql',
];
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_ALLOWLIST = ['http://localhost:5173', 'http://localhost:3000'];

// Pick the closest Supabase region from the host's IANA timezone.
// Continent prefix is enough — finer granularity isn't worth the maintenance.
function detectRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const continent = tz.split('/')[0];
    switch (continent) {
      case 'Europe':
      case 'Africa':
        return 'eu-central-1';
      case 'Asia':
      case 'Indian':
        return 'ap-southeast-1';
      case 'Australia':
      case 'Pacific':
        return 'ap-southeast-2';
      case 'America':
      case 'Atlantic':
      default:
        return 'us-east-1';
    }
  } catch {
    return DEFAULT_REGION;
  }
}

// ---------- I/O helpers ----------

const log = msg => console.log(`[nodd] ${msg}`);
const fail = msg => {
  console.error(`[nodd] error: ${msg}`);
  process.exit(1);
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.message || j.error || JSON.stringify(j);
    } catch {}
    let hint = '';
    if (res.status === 401 || res.status === 403) {
      hint =
        '\n  → Your SUPABASE_ACCESS_TOKEN is missing, expired, or lacks scope. ' +
        'Generate a fresh Personal Access Token at https://supabase.com/dashboard/account/tokens';
    } else if (res.status === 429) {
      hint = '\n  → Rate limited by the Supabase Management API. Wait a minute and re-run.';
    }
    const err = new Error(`Supabase API ${method} ${path} → ${res.status}: ${detail}${hint}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function getToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token) return token;
  console.error('[nodd] SUPABASE_ACCESS_TOKEN env var not set.');
  console.error('[nodd] Generate a Personal Access Token at:');
  console.error('[nodd]   https://supabase.com/dashboard/account/tokens');
  console.error('[nodd] Then re-run:');
  console.error('[nodd]   SUPABASE_ACCESS_TOKEN=<your-token> npx nodd init');
  process.exit(1);
}

async function ask(rl, question, defaultValue = '') {
  // Pre-fill the readline buffer with the default so the user sees the value
  // already typed in and can press Enter, or edit it inline.
  const p = rl.question(`[nodd] ${question}: `);
  if (defaultValue) rl.write(defaultValue);
  const ans = (await p).trim();
  return ans || defaultValue;
}

// ---------- repo introspection ----------

function readPkgJson(cwd) {
  const p = join(cwd, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectFramework(pkg) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.next) return 'next';
  if (deps.vite || deps['@vitejs/plugin-react']) return 'vite';
  if (deps['react-scripts']) return 'cra';
  return 'generic';
}

function envPrefixFor(framework) {
  if (framework === 'vite') return 'VITE_';
  if (framework === 'next') return 'NEXT_PUBLIC_';
  if (framework === 'cra') return 'REACT_APP_';
  return '';
}

function readGitEmail() {
  try {
    const r = spawnSync('git', ['config', '--get', 'user.email'], {
      encoding: 'utf8',
    });
    if (r.status === 0) return r.stdout.trim();
  } catch {}
  return '';
}

// ---------- Supabase ops ----------

async function pollHealthy(token, ref) {
  const start = Date.now();
  const timeout = 5 * 60 * 1000;
  process.stdout.write('[nodd] waiting for project to provision');
  while (Date.now() - start < timeout) {
    process.stdout.write('.');
    const proj = await api(`/projects/${ref}`, { token });
    if (proj.status === 'ACTIVE_HEALTHY') {
      process.stdout.write(' ✓\n');
      return;
    }
    if (
      proj.status === 'INIT_FAILED' ||
      proj.status === 'REMOVED' ||
      proj.status === 'UNKNOWN'
    ) {
      process.stdout.write(' ✗\n');
      fail(`project provisioning failed: status=${proj.status}`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  process.stdout.write(' ✗\n');
  fail('project provisioning timed out after 5 minutes');
}

async function applyMigrations(token, ref) {
  for (const file of MIGRATION_FILES) {
    const sqlPath = join(MIGRATIONS_DIR, file);
    if (!existsSync(sqlPath)) fail(`migration not found: ${sqlPath}`);
    const sql = readFileSync(sqlPath, 'utf8');
    await api(`/projects/${ref}/database/query`, {
      method: 'POST',
      token,
      body: { query: sql },
    });
    log(`✓ applied ${file}`);
  }
}

async function getAnonKey(token, ref) {
  const keys = await api(`/projects/${ref}/api-keys`, { token });
  // Legacy format: name='anon', JWT in api_key
  const legacy = keys.find(k => k.name === 'anon');
  if (legacy?.api_key) return legacy.api_key;
  // Newer format: type='publishable' or similar
  const pub = keys.find(
    k =>
      k.type === 'publishable' ||
      (k.name && k.name.startsWith('publishable')),
  );
  if (pub?.api_key) return pub.api_key;
  // Last-resort: first key that is clearly not service_role/secret
  const any = keys.find(
    k =>
      k.api_key &&
      !(k.name || '').includes('service') &&
      !(k.name || '').includes('secret') &&
      k.type !== 'secret',
  );
  if (any?.api_key) return any.api_key;
  fail('could not find a public anon/publishable key in API response');
}

async function configureAuth(token, ref, extraOrigins = []) {
  const allowlist = [...new Set([...DEFAULT_ALLOWLIST, ...extraOrigins])];
  await api(`/projects/${ref}/config/auth`, {
    method: 'PATCH',
    token,
    body: {
      site_url: DEFAULT_ALLOWLIST[0],
      uri_allow_list: allowlist.join(','),
    },
  });
  log(`✓ auth redirect URLs: ${allowlist.join(', ')}`);
}

// ---------- file writers ----------

function writeEnvLocal(cwd, prefix, projectId, ref, anonKey, force) {
  const path = join(cwd, '.env.local');
  const entries = [
    [`${prefix}NODD_PROJECT_ID`, projectId],
    [`${prefix}NODD_SUPABASE_URL`, `https://${ref}.supabase.co`],
    [`${prefix}NODD_SUPABASE_ANON_KEY`, anonKey],
  ];
  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [k, v] of entries) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(content)) {
      if (!force) {
        log(`! ${k} already in .env.local — left unchanged (use --force to overwrite)`);
        continue;
      }
      content = content.replace(re, `${k}=${v}`);
    } else {
      if (content && !content.endsWith('\n')) content += '\n';
      content += `${k}=${v}\n`;
    }
  }
  writeFileSync(path, content);
  log(`✓ wrote .env.local`);
}

function writeConfig(cwd, data) {
  const dir = join(cwd, '.nodd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify(data, null, 2) + '\n',
  );
  log(`✓ wrote .nodd/config.json`);
}

// ---------- snippet ----------

function snippet({ framework, prefix, adminEmail, openMembership, allowPublicReads }) {
  let refExpr;
  if (framework === 'next' || framework === 'cra') {
    refExpr = key => `process.env.${prefix}${key}!`;
  } else if (framework === 'vite') {
    // import.meta.env.VITE_* is typed as string | undefined under strict TS;
    // ! matches the Next/CRA shape and avoids consumer-side surprises.
    refExpr = key => `import.meta.env.${prefix}${key}!`;
  } else {
    // Unknown framework: leave placeholders the consumer must fill in.
    refExpr = key => `'<${key}>'`;
  }

  const adminLine = adminEmail
    ? `      bootstrapAdminEmail="${adminEmail}"`
    : `      // bootstrapAdminEmail="you@example.com"`;
  const openLine = openMembership ? '      openMembership' : '';
  const publicLine = allowPublicReads ? '      allowPublicReads' : '';

  return [
    `import { NoddProvider } from '@vadim_lobodin/nodd';`,
    `import '@vadim_lobodin/nodd/style.css';`,
    ``,
    `<NoddProvider`,
    `      projectId={${refExpr('NODD_PROJECT_ID')}}`,
    `      supabaseUrl={${refExpr('NODD_SUPABASE_URL')}}`,
    `      supabaseAnonKey={${refExpr('NODD_SUPABASE_ANON_KEY')}}`,
    adminLine,
    openLine,
    publicLine,
    `>`,
    `  <App />`,
    `</NoddProvider>`,
  ]
    .filter(l => l !== '')
    .join('\n');
}

// ---------- commands ----------

// Flags that take a value (`--name foo`); everything else is a boolean switch.
// Without this, a boolean flag would greedily swallow the following positional
// (e.g. `add-origin --force https://app.com` would eat the URL).
const VALUED_FLAGS = new Set(['name', 'region']);

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (VALUED_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function cmdInit(argv) {
  const { flags } = parseFlags(argv);
  const cwd = process.cwd();
  const configPath = join(cwd, '.nodd', 'config.json');
  const token = getToken();

  // Reconfigure path: re-apply migrations + auth on existing project
  if (flags.reconfigure) {
    if (!existsSync(configPath)) fail('no .nodd/config.json — run `init` first without --reconfigure');
    const existing = JSON.parse(readFileSync(configPath, 'utf8'));
    log(`reconfiguring project ${existing.projectRef}`);
    await applyMigrations(token, existing.projectRef);
    await configureAuth(token, existing.projectRef);
    log('✓ reconfigure complete');
    return;
  }

  // Block on existing config unless --force
  if (existsSync(configPath) && !flags.force) {
    const existing = JSON.parse(readFileSync(configPath, 'utf8'));
    log(`already configured: project_ref=${existing.projectRef}`);
    log(`re-run with --reconfigure (re-apply migrations) or --force (create new project)`);
    return;
  }

  // Pick org — auto-create if the account has none (fresh signup or all deleted).
  let orgs = await api('/organizations', { token });
  let org;
  const rl = createInterface({ input: stdin, output: stdout });
  if (!orgs?.length) {
    log('no Supabase organizations on this account — one is required to host the project.');
    const orgName = await ask(rl, 'create new organization?', 'Personal');
    org = await api('/organizations', {
      method: 'POST',
      token,
      body: { name: orgName },
    });
    if (!org?.id) fail(`could not create organization: ${JSON.stringify(org)}`);
    log(`✓ created organization: ${org.name}`);
    orgs = [org];
  } else if (orgs.length === 1) {
    org = orgs[0];
    log(`organization: ${org.name}`);
  } else {
    log('organizations:');
    orgs.forEach((o, i) => log(`  [${i + 1}] ${o.name}`));
    const pickRaw = await ask(rl, `pick organization`, '1');
    const idx = parseInt(pickRaw, 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= orgs.length) fail('invalid choice');
    org = orgs[idx];
  }

  // Project params — name & region are silent (flags override); only ask what matters.
  const pkg = readPkgJson(cwd);
  const name =
    (typeof flags.name === 'string' && flags.name) ||
    (pkg?.name || basename(cwd)).replace(/^@.+\//, '').replace(/[^a-z0-9-]/gi, '-');
  const region =
    (typeof flags.region === 'string' && flags.region) || detectRegion();
  log(`project name: ${name}`);
  log(`region: ${region}`);
  const adminEmail = await ask(rl, 'admin email (becomes project admin)?', readGitEmail());
  const openAns = await ask(rl, 'open membership — anyone signed in can comment? [Y/n]', 'Y');
  const openMembership = !openAns.toLowerCase().startsWith('n');
  const publicAns = await ask(rl, 'allow logged-out visitors to read comments? [y/N]', 'N');
  const allowPublicReads = publicAns.toLowerCase().startsWith('y');
  rl.close();

  // Create project
  log(`creating Supabase project "${name}" in ${region}... (this takes ~1 min)`);
  const dbPass = randomBytes(24).toString('base64url');
  let created;
  try {
    created = await api('/projects', {
      method: 'POST',
      token,
      body: {
        name,
        organization_id: org.id,
        db_pass: dbPass,
        region,
        plan: 'free',
      },
    });
  } catch (e) {
    // The most common real-world failure: the chosen org is already at its
    // free-tier project limit (Supabase caps free projects per org).
    const msg = String(e.detail || e.message || '').toLowerCase();
    const limitHit =
      e.status === 402 ||
      /free|limit|quota|exceed|maximum|payment|upgrade/.test(msg);
    if (limitHit) {
      fail(
        `couldn't create a free project in "${org.name}".\n` +
          `  → This org has likely reached its free-project limit. Either:\n` +
          `      • delete an unused project in that org, or\n` +
          `      • re-run and pick a different org, or\n` +
          `      • create the project manually and use "npx nodd init --reconfigure"\n` +
          `        (see the "Manual setup" section of INSTALL.md).\n` +
          `  Original error: ${e.detail || e.message}`
      );
    }
    throw e;
  }
  const ref = created.id || created.ref;
  if (!ref) fail(`unexpected /projects response: ${JSON.stringify(created)}`);
  log(`✓ project created: ${ref}.supabase.co`);

  await pollHealthy(token, ref);

  log('applying migrations...');
  await applyMigrations(token, ref);

  log('fetching anon key...');
  const anonKey = await getAnonKey(token, ref);

  await configureAuth(token, ref);

  const projectId = randomUUID();
  const framework = detectFramework(pkg);
  const prefix = envPrefixFor(framework);

  writeEnvLocal(cwd, prefix, projectId, ref, anonKey, !!flags.force);
  writeConfig(cwd, {
    projectRef: ref,
    projectId,
    organizationId: org.id,
    region,
    adminEmail,
    openMembership,
    allowPublicReads,
    framework,
    createdAt: new Date().toISOString(),
  });

  console.log('');
  log(`detected framework: ${framework} — env prefix: ${prefix || '(none)'}`);
  console.log('');
  log('add this to your app root:');
  console.log('');
  console.log(snippet({ framework, prefix, adminEmail, openMembership, allowPublicReads }));
  console.log('');
  log('next:');
  log('  1. start your dev server, sign in with the admin email');
  log(`  2. after deploy: SUPABASE_ACCESS_TOKEN=… npx nodd add-origin https://yourapp.example.com`);
}

async function cmdAddOrigin(argv) {
  const { positional } = parseFlags(argv);
  const url = positional[0];
  if (!url) fail('usage: nodd add-origin <url>');

  const cwd = process.cwd();
  const configPath = join(cwd, '.nodd', 'config.json');
  if (!existsSync(configPath)) {
    fail('no .nodd/config.json — run `npx nodd init` first');
  }
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const token = getToken();

  const current = await api(`/projects/${cfg.projectRef}/config/auth`, { token });
  const list = (current.uri_allow_list || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (list.includes(url)) {
    log(`already in allowlist: ${url}`);
    return;
  }
  list.push(url);
  await api(`/projects/${cfg.projectRef}/config/auth`, {
    method: 'PATCH',
    token,
    body: { uri_allow_list: list.join(',') },
  });
  log(`✓ added ${url} to redirect allowlist`);
  log(`  full list: ${list.join(', ')}`);
}

function printHelp() {
  console.log(`Nodd CLI

Usage:
  npx nodd init [--name <x>] [--region <x>] [--reconfigure] [--force]
      Create a Supabase project, apply migrations, configure auth,
      and write .env.local + .nodd/config.json.
      Name defaults to package.json#name; region is auto-picked from your timezone.

  npx nodd add-origin <url>
      Append a deploy URL to the auth redirect allowlist.

Auth:
  Set SUPABASE_ACCESS_TOKEN — generate at
  https://supabase.com/dashboard/account/tokens
`);
}

// ---------- entry ----------

const [, , cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case 'init':
      await cmdInit(rest);
      break;
    case 'add-origin':
      await cmdAddOrigin(rest);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`[nodd] unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
} catch (err) {
  fail(err?.message || String(err));
}
