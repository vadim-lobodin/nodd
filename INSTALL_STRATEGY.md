# Install Strategy — Research Notes

Working notes from a 2026-04-29 conversation about how to make Nodd easy to adopt. Captured for later review; not a decision yet.

## Target audience

**Vibecoders** — people building React prototypes quickly with AI coding tools (Cursor, Claude Code, Bolt, v0, Lovable, StackBlitz). They want to share their prototype with teammates for feedback (the Figma-comments-on-live-prototype use case).

Characteristics:
- Each vibecoder runs their own backend (not a shared org-level Supabase).
- They deploy to a host (Vercel, Netlify, Cloudflare Pages, etc.) — not localhost.
- They are working alongside an AI agent that can run shell commands and call APIs.
- They will *not* manually apply SQL migrations or read backend setup guides.

## Current friction (today's BYO flow)

To install Nodd right now, a user must:

1. `npm i nodd` ✓ trivial
2. Create a Supabase project (web dashboard)
3. Apply the baseline SQL migration `supabase/migrations/0001_nodd_init.sql` (now bundled in the npm tarball — no repo clone needed)
4. Enable email magic-link auth
5. Insert a `projects` row to get a `projectId`
6. Insert a `project_members` row for themselves
7. Wrap app in `<NoddProvider>` with three props
8. Import `nodd/style.css`

For a manual install this is ~30 minutes. For an AI-agent install it can be much shorter, but the recipe needs to exist.

## Options considered

### A. Hosted Nodd (multi-tenant SaaS)
Run one shared Supabase, vibecoders sign up at `align.dev`, get an `apiKey`, paste `<NoddProvider apiKey="...">`. True drop-in.

- **Pro:** simplest possible UX (~60 sec).
- **Pro:** the existing schema is already scoped by `project_id`, so this is mostly a deployment + signup-flow problem, not a rewrite.
- **Con:** reverses the design doc ("backend is consumer's own Supabase, no Nodd-hosted server").
- **Con:** you become a backend operator — multi-tenant RLS, abuse prevention, billing, GDPR, scaling costs.

### B. Hosted free tier + BYO escape hatch
Default to hosted for 99% of users; power users / privacy-sensitive teams self-host with the existing migrations.

- **Pro:** Clerk / Supabase / Vercel playbook.
- **Con:** still a backend operator, plus two install paths to maintain.

### C. BYO + agent-driven install (recommended after discussion)
Keep current architecture. Make the install recipe agent-friendly so the agent does the Supabase setup end-to-end.

- **Pro:** zero ops for Nodd maintainers.
- **Pro:** users own their data — no privacy / residency / compliance concerns.
- **Pro:** matches the "vibecoder + agent" workflow already in use.
- **Con:** vibecoder must create a Supabase account once (~2 min, human-in-the-loop).
- **Con:** doesn't fit walled-garden prototype hosts (Lovable, Bolt) where adding domains to Supabase auth allowlist is hard or where deploy URLs rotate per share.

## Why deployment doesn't break BYO

The audience deploys to real hosts (Vercel etc.), not localhost. Walking through what that adds:

| Concern | Status |
|---|---|
| Env vars on the host | Not actually needed. The Supabase **anon key is public by design** (RLS protects data). Vibecoders can hardcode `supabaseUrl` / `anonKey` / `projectId` directly in JSX. Works on platforms that don't expose env-var UI. |
| Magic-link redirects | The one real new step. After deploy, the prod origin (e.g. `myapp.vercel.app`) must be added to Supabase auth redirect allowlist. Doable via Supabase Management API once the URL is known. |
| CORS | Handled by Supabase out of the box for the anon path. |
| Supabase project URL | Already publicly addressable at `xxx.supabase.co`. No deploy concerns. |

Net new step from deployment: **one** — patch the auth allowlist after the prod URL is known. Agent-scriptable.

## What's missing today to make BYO actually painless

1. **Bundle `supabase/migrations/` inside the npm package.** ✅ Done — `package.json` `files` includes `supabase/migrations`, and the schema is now a single baseline file (`0001_nodd_init.sql`) so a single `npm i nodd` puts the SQL on disk ready to apply.
2. **Agent-readable `INSTALL.md` at the package root.** ✅ Done — `INSTALL.md` is in the published tarball; CLI flow is the primary path, manual flow documented at the bottom for restricted environments.
3. **`npx nodd init`** ✅ Done — `bin/nodd.mjs` ships in the npm package. Creates a Supabase project via the Management API, applies migrations, configures auth redirects, detects framework (Vite/Next/CRA), writes `.env.local` + `.nodd/config.json`, prints a ready-to-paste `<NoddProvider>` snippet. Companion `add-origin <url>` patches the redirect allowlist after deploy. Reads `SUPABASE_ACCESS_TOKEN` from env (one human step: token generation in the Supabase dashboard).

## Decision (current)

Shipped **Option C** — BYO + agent/CLI-driven install — by completing items 1, 2, and 3 above. Revisit hosted Nodd (Option A/B) only if data shows meaningful drop-off on Lovable/Bolt-style platforms where neither the CLI nor the agent recipe applies.

Hosted Nodd remains a separate product decision (commits Nodd maintainers to running infra). Don't conflate "make install easier" with "become a SaaS."

## Open questions

- Should the agent recipe / CLI README explicitly walk users through generating the Personal Access Token, or assume they already have one?
- For Lovable/Bolt/v0 specifically: is there a walled-garden-friendly variant (e.g. ship a public demo Supabase with rate limits and 7-day data expiry)?
- Should `add-origin` be auto-invoked from a Vercel/Netlify deploy hook, or left as an explicit step in the recipe?
