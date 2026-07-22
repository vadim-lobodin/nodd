# Nodd

**Figma-like spatial comments and state variants for live React prototypes.**

Nodd is a drop-in React library that overlays two collaboration tools on top of a running prototype:

- **Spatial comments** — click anywhere on the page to drop a pin and start a thread, Figma-style. Pins are anchored to DOM elements and survive reloads, resizes, and layout shifts.
- **State variants** — declare alternative versions of a screen or component in code (two hero designs, single-page vs. wizard checkout), and let reviewers flip between them from the overlay. Comments are variant-aware, so feedback stays attached to the version it was left on.

The backend is **your own** [Supabase](https://supabase.com) project — there is no Nodd-hosted server. Comment data, magic-link auth, and Row-Level Security all live in a project you control.

## Install

```bash
npm install @vadim_lobodin/nodd
```

`react` and `react-dom` (18+) are peer dependencies. See **[INSTALL.md](./INSTALL.md)** for the full 2-minute setup — the `npx nodd init` CLI provisions the Supabase project, applies migrations, and prints a ready-to-paste snippet.

## Quick start

```tsx
import { NoddProvider } from '@vadim_lobodin/nodd';
import '@vadim_lobodin/nodd/style.css';

<NoddProvider
  projectId={import.meta.env.VITE_NODD_PROJECT_ID}
  supabaseUrl={import.meta.env.VITE_NODD_SUPABASE_URL}
  supabaseAnonKey={import.meta.env.VITE_NODD_SUPABASE_ANON_KEY}
  bootstrapAdminEmail="you@example.com"
  openMembership
  allowPublicReads   // optional: let logged-out visitors read comments (opt-in)
>
  <App />
</NoddProvider>
```

A small toolbar appears bottom-right. Press **C** to enter comment mode and click to drop a pin; press **V** to open the variants panel.

## Comments

- Click a spot on the page to anchor a pin and open a thread.
- Threads sync in real time across viewers via Supabase Realtime.
- Pins re-anchor to their element on resize and route changes; unresolvable pins fall back to the sidebar.
- Mentions, resolve/delete, and read-only pins for signed-out viewers.

**Logged-out reading is opt-in.** By default comments are members-only. Set `allowPublicReads` on `<NoddProvider>` (applied through the `bootstrapAdminEmail` flow), answer *yes* to the CLI `init` prompt, or flip it later with SQL:

```sql
update projects set allow_public_reads = true where id = '<your-project-id>';
```

When enabled, anyone who can load the page sees pins and threads read-only — no sign-in. Writing (new threads, replies, resolve, delete) always requires signing in. Mutations stay members-only regardless of this flag.

## State variants

Declare variants in code two ways:

```tsx
import { useVariant, Variant } from '@vadim_lobodin/nodd';

// Hook — feature-flag style. Returns the active option (default: first).
// Safe without <NoddProvider>: returns options[0], never throws.
const layout = useVariant('checkout-layout', ['single-page', 'wizard'], {
  label: 'Checkout layout',
});

// Component — swap whole blocks. Options derived from object keys.
<Variant
  name="hero"
  label="Hero style"
  options={{ minimal: <HeroMinimal />, bold: <HeroBold /> }}
/>
```

Reviewers switch variants from the **Variants panel** (toolbar button or press **V**). Switching is **per-viewer** — persisted to `localStorage`, never synced between viewers. Comments left on a `<Variant>` are tagged with the active option, so they hide when a different option is shown and reappear (with a breadcrumb) when you switch back.

### Local UI states

Nodd cannot infer arbitrary React state from the DOM. If one URL swaps between
steps, tabs, modals, or reducer states, wrap the stateful region in
`<NoddState>` so comments do not leak into another state:

```tsx
import { NoddState, useNoddActivator } from '@vadim_lobodin/nodd';

function OnboardingFlow() {
  const [step, setStep] = useState<'welcome' | 'add-users'>('welcome');
  const showWelcome = useCallback(() => setStep('welcome'), []);
  const showAddUsers = useCallback(() => setStep('add-users'), []);

  useNoddActivator('step:welcome', showWelcome);
  useNoddActivator('step:add-users', showAddUsers);

  return (
    <NoddState name={`step:${step}`}>
      {step === 'welcome' ? <Welcome /> : <AddUsers />}
    </NoddState>
  );
}
```

The wrapper uses `display: contents`, so it does not change layout. Activators
are optional, but let the sidebar's **Show me** action restore the state. A
hook-only `useVariant()` also creates no DOM boundary; wrap the affected region
in `NoddState` or use `<Variant>` when comments must follow that option.

## API surface

The public surface is intentionally tiny:

```ts
import {
  NoddProvider,
  NoddState,
  useNodd,
  useNoddActivator,
  useVariant,
  Variant,
} from '@vadim_lobodin/nodd';

const { user, signIn, signOut, toggleOverlay, hideForDuration, isVisible } = useNodd();
```

## How it works

Nodd renders into two body-attached portals and has **zero host impact when the overlay is off** — the entire UI unmounts and all CSS is scoped under `[data-nodd-root]`. Comments are page-scoped, cached in IndexedDB, and reconciled optimistically. See [`DESIGN_DOC.md`](./DESIGN_DOC.md) and the per-module `README.md` files for the full architecture.

## License

MIT © Vadim Lobodin
