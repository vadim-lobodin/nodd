import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

/**
 * Presentational reproduction of the auth gate rendered inline in
 * `OverlayRenderer` (`src/overlay/OverlayRenderer.tsx`, the `if (!user)` and
 * `needsDisplayName` branches). Kept in sync with that markup so the login UI
 * can be previewed and themed without booting a live Supabase session.
 */

function SignInGate({ initialSent = false }: { initialSent?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(initialSent);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    if (!name.trim() || !email.trim()) {
      setError('Enter your name and email address.');
      return;
    }
    setError(null);
    setSending(true);
    // Simulate the magic-link round-trip for the story.
    window.setTimeout(() => {
      setSending(false);
      setSent(true);
    }, 600);
  };

  return (
    <div className="nodd-auth-backdrop">
      <div className="nodd-auth-gate nodd-auth-gate--center" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="nodd-auth-sent">
            <p>Check your email for a sign-in link.</p>
            <button className="nodd-btn" onClick={() => setSent(false)}>Try again</button>
          </div>
        ) : (
          <form
            className="nodd-auth-form"
            onSubmit={e => { e.preventDefault(); handleSignIn(); }}
          >
            <h2 className="nodd-auth-title">Log in to leave comments</h2>
            <input
              className="nodd-auth-input"
              type="text"
              name="name"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={e => { setName(e.target.value); setError(null); }}
              autoFocus
              required
            />
            <input
              className="nodd-auth-input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null); }}
              required
            />
            <button
              className="nodd-btn nodd-btn--primary"
              type="submit"
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="nodd-auth-error" role="alert">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

function NamePrompt() {
  const [name, setName] = useState('');
  return (
    <div className="nodd-auth-backdrop">
      <div className="nodd-auth-gate nodd-auth-gate--center" onClick={e => e.stopPropagation()}>
        <div className="nodd-auth-form">
          <h2 className="nodd-auth-title">Welcome! What should we call you?</h2>
          <input
            className="nodd-auth-input"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <button className="nodd-btn nodd-btn--primary">Continue</button>
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof SignInGate> = {
  title: 'Nodd/Login',
  component: SignInGate,
};
export default meta;
type Story = StoryObj<typeof SignInGate>;

/** Name + email entry → "Send magic link". */
export const SignIn: Story = {};

/** Confirmation state after the magic link has been sent. */
export const MagicLinkSent: Story = {
  args: { initialSent: true },
};

/** Legacy fallback for an existing account without a display name. */
export const NamePrompt_: Story = {
  name: 'Name Prompt (legacy fallback)',
  render: () => <NamePrompt />,
};
