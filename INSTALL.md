# Installing Nodd

Add Nodd (Figma-like spatial comments and state variants) to a React app. The CLI does end-to-end Supabase setup; a manual path is documented at the bottom for non-CLI environments.

Nodd uses **your own** Supabase project as the backend — there is no Nodd-hosted server. Magic-link sign-in, comment data, and Row-Level Security policies all live in a Supabase project that you control.

**Time:** ~2 minutes with the CLI. The only human step is generating a Supabase Personal Access Token (one click, one-time per account).

---

## Prerequisites

- A React 18+ app (Vite, Next.js, CRA, Remix — anything that renders React in a browser).
- Node 18+ and npm/pnpm/yarn.
- A Supabase account (free tier is fine): <https://supabase.com>.

---

## Step 1 — Install the package

```bash
npm install nodd
```

Peer deps (`react`, `react-dom`) must already be present.

---

## Step 2 — Generate a Supabase access token

**One-time per Supabase account.** Open <https://supabase.com/dashboard/account/tokens>, click **Generate new token**, name it (e.g. "nodd-cli"), and copy the token.

Export it for the next step:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx
```

The token is only used by the CLI — it is **not** stored on disk and not embedded in your app.

---

## Step 3 — Run `init`

```bash
npx nodd init
```

This will:

1. Create a Supabase project (free tier, in the org you pick).
2. Wait for it to become healthy (~1 min).
3. Apply the Nodd migrations (`0001_nodd_init.sql`, `0002_bootstrap.sql`).
4. Configure auth redirect URLs for `http://localhost:5173` and `http://localhost:3000`.
5. Generate a `projectId` UUID.
6. Detect your framework (Vite/Next/CRA) and write `.env.local` with the right env-var prefix.
7. Save `.nodd/config.json` (project ref + metadata; **no secrets**).
8. Print a ready-to-paste `<NoddProvider>` snippet.

Add `.env.local` and `.nodd/` to `.gitignore` if your project doesn't already.

---

## Step 4 — Wire up the React component

Paste the snippet `init` printed into your app root, e.g. `src/main.tsx` (Vite) or `app/layout.tsx` (Next.js):

```tsx
import { NoddProvider } from 'nodd';
import 'nodd/style.css';

<NoddProvider
  projectId={import.meta.env.VITE_NODD_PROJECT_ID}
  supabaseUrl={import.meta.env.VITE_NODD_SUPABASE_URL}
  supabaseAnonKey={import.meta.env.VITE_NODD_SUPABASE_ANON_KEY}
  bootstrapAdminEmail="you@example.com"
  openMembership
>
  <App />
</NoddProvider>
```

(Adjust `import.meta.env.VITE_…` → `process.env.NEXT_PUBLIC_…` for Next.js, etc. — `init` prints the right form for your framework.)

**No manual SQL needed:**
- The first time you sign in with the email matching `bootstrapAdminEmail`, the project row and your admin membership are created automatically.
- With `openMembership`, anyone else who signs in is auto-added as a member and can comment. Drop the flag for a closed prototype.

---

## Step 5 — Deploy

After your first deploy, register the production origin:

```bash
npx nodd add-origin https://myapp.vercel.app
```

For preview deploys with rotating URLs (Vercel/Netlify), use a wildcard:

```bash
npx nodd add-origin "https://*.vercel.app"
```

The CLI patches Supabase's auth redirect allowlist via the Management API. Without it, magic-link emails will redirect to `localhost` and fail.

---

## Verifying the install

1. Load the app. The Nodd toolbar should appear bottom-right.
2. Open the comments panel → enter your admin email → check inbox → click the magic link. You should land back on the app, signed in.
3. Press `C` to enter comment mode, then click somewhere on the page. A thread popover opens.
4. Type a comment, send it. A pin appears at the click location.
5. Reload — pin and comment persist.
6. (Multi-user) Open the app in another browser, sign in with a different email. With `openMembership` on, that user is auto-added and can immediately comment.
7. (If your app declares variants) Press `V` to open the variants panel and switch between declared options. Comments left on a `<Variant>` follow the option they were placed on.

Common errors in the browser console:

- `Failed to fetch threads` — no `project_members` row for the user. Either enable `openMembership`, sign in as `bootstrapAdminEmail`, or insert a member row manually.
- `Auth session missing` — the redirect URL isn't in the allowlist. Run `add-origin <url>`.

---

## Re-running `init`

| Situation | Command |
|---|---|
| Apply newer migrations / re-fix auth on existing project | `npx nodd init --reconfigure` |
| Throw away config and create a fresh project | `npx nodd init --force` |
| Add a new deploy origin | `npx nodd add-origin <url>` |

---

## Architecture quick reference

| Concern | Answer |
|---|---|
| Where does the data live? | Your Supabase project. Nodd maintainers never see it. |
| Is the anon key really safe in client code? | Yes — it's the same model Supabase recommends for any web app. RLS enforces access on the server. |
| Can I use Nodd with multiple prototypes? | Yes — run `init` per app; each gets its own Supabase project + `projectId`. |
| How do I add teammates? | Pass `openMembership` — anyone who signs in becomes a member. For closed prototypes, insert one `project_members` row per teammate. |
| How do I uninstall? | `npm uninstall nodd`. Drop the migrations or leave them — tables are isolated. The host app is unaffected when the provider is unmounted. |

---

## Manual setup (without the CLI)

Use this only if you can't run `npx nodd init` (e.g. agent-restricted environment, shared Supabase project, or self-hosted Supabase).

1. **Create a Supabase project** at <https://supabase.com/dashboard>. Copy the **Project URL** and **anon public key** from Settings → API.
2. **Apply migrations** via the SQL editor: paste `node_modules/nodd/supabase/migrations/0001_nodd_init.sql`, then `0002_bootstrap.sql`. Run each.
3. **Configure auth** at Authentication → URL Configuration: set **Site URL** to `http://localhost:5173`, add your local + deploy origins to **Redirect URLs**.
4. **Generate a `projectId` UUID** (any tool — `uuidgen`, `crypto.randomUUID()` in the browser console).
5. **Wire up `<NoddProvider>`** with the four values from steps 1+4 plus `bootstrapAdminEmail` and (optionally) `openMembership`. Sign in once — the bootstrap RPC creates the project row and your membership automatically.
6. **For each new deploy origin**, add it to the Redirect URLs allowlist in the dashboard.

The CLI does all of the above with one command — prefer it whenever possible.
