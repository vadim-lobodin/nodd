import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { NoddButton, NoddInput } from '../overlay/components/FormControls';

/**
 * Presentational reproduction of the inline sidebar auth section rendered by
 * `OverlayRenderer`. Kept in sync so the login UI can be previewed and themed
 * without booting a live Supabase session.
 */

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="nodd-sidebar"
      style={{ position: 'relative', inset: 'auto', height: 520, margin: 0 }}
    >
      <div className="nodd-sidebar-header">
        <div className="nodd-sidebar-title">Comments</div>
      </div>
      {children}
    </div>
  );
}

function SignInGate({
  initialExpanded = false,
  initialSent = false,
}: {
  initialExpanded?: boolean;
  initialSent?: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(initialSent);
  const [expanded, setExpanded] = useState(initialExpanded || initialSent);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    if (!name.trim()) {
      setError('Enter your name.');
      return;
    }
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
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
    <PanelShell>
      <section className="nodd-sidebar-auth" aria-label="Comment access">
        {expanded ? (
          sent ? (
            <div className="nodd-auth-sent" role="status">
              <p>Check your email for a sign-in link.</p>
              <NoddButton variant="secondary" onClick={() => setSent(false)}>
                Try again
              </NoddButton>
            </div>
          ) : (
            <form
              className="nodd-auth-form"
              noValidate
              onSubmit={e => { e.preventDefault(); handleSignIn(); }}
            >
              <div>
                <div className="nodd-auth-title">Log in</div>
                <p className="nodd-auth-description">Enter your details to leave comments.</p>
              </div>
              <NoddInput
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={e => { setName(e.target.value); setError(null); }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'story-auth-error' : undefined}
                autoFocus
              />
              <NoddInput
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null); }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'story-auth-error' : undefined}
              />
              <NoddButton
                type="submit"
                fullWidth
                disabled={sending}
              >
                {sending ? 'Sending…' : 'Send magic link'}
              </NoddButton>
              {error ? (
                <p id="story-auth-error" className="nodd-auth-error" role="alert">{error}</p>
              ) : null}
            </form>
          )
        ) : (
          <>
            <div>
              <div className="nodd-auth-title">Log in to leave comments</div>
              <p className="nodd-auth-description">You can read existing comments without an account.</p>
            </div>
            <NoddButton
              fullWidth
              onClick={() => setExpanded(true)}
            >
              Log in
            </NoddButton>
          </>
        )}
      </section>
    </PanelShell>
  );
}

function NamePrompt() {
  const [name, setName] = useState('');
  return (
    <PanelShell>
      <section className="nodd-sidebar-auth" aria-label="Comment access">
        <div className="nodd-auth-form">
          <div className="nodd-auth-title">Welcome! What should we call you?</div>
          <NoddInput
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <NoddButton fullWidth>Continue</NoddButton>
        </div>
      </section>
    </PanelShell>
  );
}

const meta: Meta<typeof SignInGate> = {
  title: 'Nodd/Login',
  component: SignInGate,
};
export default meta;
type Story = StoryObj<typeof SignInGate>;

/** Read-only viewer prompt before they choose to log in. */
export const LogInPrompt: Story = {};

/** Name + email entry, expanded in place after clicking "Log in". */
export const SignIn: Story = {
  args: { initialExpanded: true },
};

/** Confirmation state after the magic link has been sent. */
export const MagicLinkSent: Story = {
  args: { initialSent: true },
};

/** Legacy fallback for an existing account without a display name. */
export const NamePrompt_: Story = {
  name: 'Name Prompt (legacy fallback)',
  render: () => <NamePrompt />,
};
