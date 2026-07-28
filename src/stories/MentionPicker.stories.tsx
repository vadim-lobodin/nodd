import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { MentionPicker, type ProjectMember } from '../overlay/components/MentionPicker';

const MEMBERS: ProjectMember[] = [
  { id: 'u1', display_name: 'Alice Chen' },
  { id: 'u2', display_name: 'Bob Smith' },
  { id: 'u3', display_name: 'Carol Jones' },
  { id: 'u4', display_name: 'Dan Lee' },
];

const CARET_RECT = new DOMRect(80, 120, 1, 16);

function PickerStory({ query = '' }: { query?: string }) {
  return (
    <div style={{ position: 'relative', height: 250 }}>
      <MentionPicker
        open
        query={query}
        caretRect={CARET_RECT}
        members={MEMBERS}
        recentCollaboratorIds={['u1']}
        onSelect={() => {}}
        onCancel={() => {}}
        onKeyboardRef={() => {}}
        triggerFrom={0}
        triggerTo={0}
      />
    </div>
  );
}

const meta: Meta<typeof PickerStory> = {
  title: 'Nodd/MentionPicker',
  component: PickerStory,
};
export default meta;
type Story = StoryObj<typeof PickerStory>;

export const AllMembers: Story = { args: { query: '' } };
export const Filtered: Story = { args: { query: 'al' } };
