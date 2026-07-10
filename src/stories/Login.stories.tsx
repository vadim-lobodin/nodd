import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

/**
 * Presentational reproduction of the auth gate rendered inline in
 * `OverlayRenderer` (`src/overlay/OverlayRenderer.tsx`, the `if (!user)` and
 * `needsDisplayName` branches). Kept in sync with that markup so the login UI
 * can be previewed and themed without booting a live Supabase session.
 */

function SignInGate({ initialSent = false }: { initialSent?: boolean }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(initialSent);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    if (!email.trim()) {
      setError('Enter your email address.');
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
          <div className="nodd-auth-form">
            <h2 className="nodd-auth-title">Log in to leave comments</h2>
            <input
              className="nodd-auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSignIn()}
              autoFocus
            />
            <button
              className="nodd-btn nodd-btn--primary"
              onClick={handleSignIn}
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="nodd-auth-error" role="alert">{error}</p>}
          </div>
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

/** Email entry → "Send magic link". */
export const SignIn: Story = {};

/** Confirmation state after the magic link has been sent. */
export const MagicLinkSent: Story = {
  args: { initialSent: true },
};

/** First-time viewer choosing a display name after signing in. */
export const NamePrompt_: Story = {
  name: 'Name Prompt',
  render: () => <NamePrompt />,
};
