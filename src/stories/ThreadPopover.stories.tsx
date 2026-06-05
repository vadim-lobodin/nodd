import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ThreadPopover, type ThreadComment } from '../overlay/components/ThreadPopover';

const MEMBERS = [
  { userId: 'u1', displayName: 'Alice Chen', email: 'alice@example.com', avatarUrl: undefined },
  { userId: 'u2', displayName: 'Bob Smith', email: 'bob@example.com', avatarUrl: undefined },
];

const BASE_COMMENT: ThreadComment = {
  id: 'c1',
  authorId: 'u1',
  body: 'This button needs more contrast — barely readable at small sizes.',
  mentions: [],
  createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  editedAt: null,
};

const REPLY: ThreadComment = {
  id: 'c2',
  authorId: 'u2',
  body: "Agreed, I'll bump it to 4.5:1 minimum.",
  mentions: [],
  createdAt: new Date(Date.now() - 1800 * 1000).toISOString(),
  editedAt: null,
};

// ThreadPopover uses position:absolute + translate — render inside a positioned
// container with enough height so the popover is fully visible.
function PopoverWrapper({
  comments,
  resolved = false,
}: {
  comments: ThreadComment[];
  resolved?: boolean;
}) {
  return (
    <div style={{ position: 'relative', height: 420 }}>
      <ThreadPopover
        threadId="thread-1"
        anchorX={0}
        anchorY={8}
        comments={comments}
        currentUserId="u1"
        resolved={resolved}
        members={MEMBERS}
        onSubmitReply={async () => {}}
        onToggleResolved={async () => {}}
        onClose={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof PopoverWrapper> = {
  title: 'Nodd/ThreadPopover',
  component: PopoverWrapper,
};
export default meta;
type Story = StoryObj<typeof PopoverWrapper>;

export const Empty: Story = { args: { comments: [] } };
export const SingleComment: Story = { args: { comments: [BASE_COMMENT] } };
export const WithReplies: Story = { args: { comments: [BASE_COMMENT, REPLY] } };
export const Resolved: Story = { args: { comments: [BASE_COMMENT, REPLY], resolved: true } };
