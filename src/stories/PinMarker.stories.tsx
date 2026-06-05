import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PinMarker } from '../overlay/components/PinMarker';
import { PinContainer } from './NoddDecorator';

// PinMarker CSS is scoped under [data-nodd-pin-container], not [data-nodd-root].
// The data-nodd-theme attribute must mirror the global background theme — the
// global decorator (preview.tsx) sets data-nodd-theme on [data-nodd-root], but
// PinContainer is a sibling scope, so we duplicate the attribute here.
// Workaround: pass theme as a prop so stories can forward it.
function PinStory({ state }: { state: 'idle' | 'unread' | 'active' }) {
  return (
    <PinContainer>
      <PinMarker
        threadId="thread-1"
        x={60}
        y={60}
        state={state}
        authorName="Alice Chen"
        snippet="This button needs more contrast — barely readable at small sizes."
        tooltipContainer={null}
        onOpen={() => {}}
      />
    </PinContainer>
  );
}

const meta: Meta<typeof PinStory> = {
  title: 'Nodd/PinMarker',
  component: PinStory,
};
export default meta;
type Story = StoryObj<typeof PinStory>;

export const Idle: Story = { args: { state: 'idle' } };
export const Unread: Story = { args: { state: 'unread' } };
export const Active: Story = { args: { state: 'active' } };
