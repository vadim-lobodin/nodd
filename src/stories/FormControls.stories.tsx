import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { NoddButton, NoddInput } from '../overlay/components/FormControls';

function FormControlsPreview() {
  return (
    <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Inputs</div>
        <NoddInput aria-label="Name" placeholder="Your name" />
        <NoddInput aria-label="Email" type="email" defaultValue="you@example.com" />
        <NoddInput aria-label="Disabled input" placeholder="Disabled" disabled />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Buttons</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <NoddButton>Primary</NoddButton>
          <NoddButton variant="secondary">Secondary</NoddButton>
        </div>
        <NoddButton fullWidth>Full width</NoddButton>
        <NoddButton disabled>Disabled</NoddButton>
      </section>
    </div>
  );
}

const meta: Meta<typeof FormControlsPreview> = {
  title: 'Nodd/Components/Form Controls',
  component: FormControlsPreview,
};

export default meta;
type Story = StoryObj<typeof FormControlsPreview>;

export const Overview: Story = {};

export const SimpleForm: Story = {
  render: () => (
    <form
      style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 10 }}
      onSubmit={event => event.preventDefault()}
    >
      <NoddInput name="name" autoComplete="name" placeholder="Your name" />
      <NoddInput name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      <NoddButton type="submit" fullWidth>Send magic link</NoddButton>
    </form>
  ),
};
