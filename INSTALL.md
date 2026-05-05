# Installing Align

This is a precise recipe for adding Align (Figma-like comments) to a React app. It is written to be followed by an AI coding agent (Cursor, Claude Code, etc.) end-to-end, but a human can run the same steps.

Align uses **your own** Supabase project as the backend — there is no Align-hosted server. The user-facing magic-link sign-in, the comment data, and the Row-Level Security policies all live in a Supabase project that you control.

**Time:** ~5 minutes with an agent. The only human step is creating the Supabase project (clicking through signup once).

---

## Prerequisites

- A React 18+ app (Vite, Next.js, CRA, Remix — anything that renders React in a browser).
- Node 18+ and npm/pnpm/yarn.
- A Supabase account. Free tier is fine: <https://supabase.com>.

---

## Step 1 — Install the package

```bash
npm install @align/react
```

Peer deps (`react`, `react-dom`) must already be present. Everything else (Supabase client, Radix primitives, Carbon icons) is bundled or marked external as appropriate.

---

## Step 2 — Create a Supabase project

**Human step.** Visit <https://supabase.com/dashboard>, click **New project**, pick a name and a region close to your users, and wait ~1 minute for provisioning.

Once it's ready, from the dashboard's **Project Settings → API** page, copy:

- **Project URL** — looks like `https://xxxxxxxx.supabase.co`
- **anon public key** — a long JWT starting with `eyJ...`

The anon key is **safe to put in client code**. RLS (enabled by every migration below) is what actually protects the data; the anon key alone yields zero rows for non-members.

You will also want the **project ref** (the `xxxxxxxx` portion of the URL) for the CLI step.

---

## Step 3 — Apply the database migrations

Align ships its SQL migrations inside the npm package at `node_modules/@align/react/supabase/migrations/`. Apply them to the Supabase project from Step 2.

### Option A — Supabase CLI (recommended)

```bash
# Install the CLI if you don't have it
npm install -g supabase

# Log in (opens a browser)
supabase login

# Link this repo to your Supabase project
supabase link --project-ref <your-project-ref>

# Copy Align's migrations into your repo so the CLI tracks them
mkdir -p supabase/migrations
cp node_modules/@align/react/supabase/migrations/*.sql supabase/migrations/

# Apply
supabase db push
```

`supabase db push` is idempotent — applied migrations are tracked in `supabase_migrations.schema_migrations` and re-runs are no-ops.

### Option B — Paste in the SQL editor

If you don't want a CLI dependency: open **SQL editor** in the Supabase dashboard, then for each file in `node_modules/@align/react/supabase/migrations/` (in numeric order, `0001` → `0009`), paste the contents and click **Run**.

### What the migrations create

| Migration | What it does |
|---|---|
| `0001_projects.sql` | `projects` table |
| `0002_project_members.sql` | `project_members` join table + `project_role` enum |
| `0003_threads_comments.sql` | `threads` and `comments` tables (the comment data) |
| `0004_profiles_view.sql` | `profiles` view over `auth.users` (safe column subset) |
| `0005_helpers.sql` | `is_project_member(uuid)` SECURITY DEFINER helper |
| `0006_rls_policies.sql` | All Row-Level Security policies — non-members see nothing |
| `0007_indexes.sql` | Partial index that makes the page query <200ms |
| `0008_realtime_publication.sql` | Adds `threads`/`comments` to `supabase_realtime` |
| `0009_threads_state_key.sql` | Adds `state_key` column for state-aware comments |

---

## Step 4 — Enable magic-link auth

In the Supabase dashboard:

1. **Authentication → Providers → Email** — make sure **Enable Email provider** is on (it is by default) and **Confirm email** is enabled.
2. **Authentication → URL Configuration** — set **Site URL** to your deployed origin (e.g. `https://myapp.vercel.app`). For local dev, also add `http://localhost:5173` (or whatever port your dev server uses) to **Redirect URLs**.

Align signs users in with `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })`, so any origin you want to support **must** appear in the redirect allowlist.

---

## Step 5 — Create a project row and add yourself as a member

Align's data model expects (a) a `projects` row representing this prototype and (b) a `project_members` row linking your `auth.users` id to it.

In the dashboard's **SQL editor**, run:

```sql
-- Create the project. Save the returned id.
insert into projects (name) values ('My Prototype') returning id;
```

Copy the returned `id` (UUID) — this is the `projectId` you'll pass to `<AlignProvider>`.

Then, sign in to your app once with your own email (after Step 6 is wired up) so an `auth.users` row exists for you, and run:

```sql
-- Replace both UUIDs.
insert into project_members (project_id, user_id, role)
select '<project-id-from-above>', id, 'admin'
from auth.users
where email = 'you@example.com';
```

Repeat for any teammate you want to comment on the prototype.

> Tip: you can run this membership insert *after* the user has signed in once (which creates their `auth.users` row). Until they're a member, they'll see the overlay UI but no data — RLS hides everything from non-members.

---

## Step 6 — Wire up the React component

```tsx
// e.g. src/main.tsx (Vite) or app/layout.tsx (Next.js)
import { AlignProvider } from '@align/react';
import '@align/react/style.css';

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <AlignProvider
      projectId="<project-id-from-step-5>"
      supabaseUrl="https://<your-ref>.supabase.co"
      supabaseAnonKey="<anon-public-key>"
    >
      {children}
    </AlignProvider>
  );
}
```

Hardcoding these three values in JSX is fine — they are all public. If you prefer env vars, that works too (`import.meta.env.VITE_…` in Vite, `process.env.NEXT_PUBLIC_…` in Next.js).

When `AlignProvider` mounts, it appends two portals to `document.body` (`align-pins` and `align-root`) and an Align toolbar appears in the bottom-right of every page in the app. Click it to sign in, then start dropping pins.

---

## Step 7 — Deploy

The deployment story has **one** new step beyond a normal React app:

After your first deploy, copy the production origin (e.g. `https://myapp.vercel.app`) into Supabase's **Authentication → URL Configuration → Redirect URLs**. Without this, magic-link emails will redirect to `localhost` and fail.

Anon key, project URL, and `projectId` can be checked into source — RLS protects the data.

---

## Verifying the install

1. Load the app. The Align toolbar (two icon buttons) should appear bottom-right.
2. Click the menu button → enter your email → check inbox → click the magic link. You should land back on the app, signed in.
3. Click the `+` button, then click somewhere on the page. A thread popover opens.
4. Type a comment, send it. A pin appears at the click location.
5. Reload the page. The pin and comment should still be there (it round-tripped through Supabase).

If pins don't render: check the browser console. The two most common errors are:

- `Failed to fetch threads` — the `auth.users` row exists but no `project_members` row links it to the project. Re-run the membership insert from Step 5.
- `Auth session missing` — the email's redirect URL isn't in Supabase's allowlist. Add it (Step 4 / Step 7).

---

## Architecture quick reference

| Concern | Answer |
|---|---|
| Where does the data live? | Your Supabase project. Align maintainers never see it. |
| Is the anon key really safe in client code? | Yes — it's the same model Supabase recommends for any web app. RLS enforces access on the server. |
| Can I use Align with multiple prototypes? | Yes — one `projects` row each, pass a different `projectId` per app. |
| How do I add teammates? | One `project_members` row per teammate (Step 5). A future invite-link UI is on the roadmap. |
| How do I uninstall? | `npm uninstall @align/react`, drop the migrations (or just leave them — they're isolated tables). The host app is unaffected when the provider is unmounted.
