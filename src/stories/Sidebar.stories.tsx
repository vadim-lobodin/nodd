import React, { useState, useRef, useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Sidebar, type ThreadSummary } from '../overlay/components/Sidebar';

const THREADS: ThreadSummary[] = [
  {
    id: 't1',
    authorName: 'Alice Chen',
    snippet: 'This button needs more contrast — barely readable at small sizes.',
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    replyCount: 2,
    resolved: false,
    unread: true,
  },
  {
    id: 't2',
    authorName: 'Bob Smith',
    snippet: 'Navigation feels off on mobile, the drawer overlaps the footer.',
    createdAt: new Date(Date.now() - 7200 * 1000).toISOString(),
    replyCount: 0,
    resolved: false,
    unread: false,
  },
  {
    id: 't3',
    authorName: 'Carol Jones',
    snippet: 'Love the new hero section — feels much more energetic.',
    createdAt: new Date(Date.now() - 86400 * 1000).toISOString(),
    replyCount: 1,
    resolved: false,
    unread: false,
  },
];

// Sidebar uses Radix Dialog.Portal — it portals into `container`, which must be
// inside [data-nodd-root] for CSS to apply. We find the global decorator's root
// div via querySelector after mount.
function SidebarStory({ threads = THREADS }: { threads?: ThreadSummary[] }) {
  const [open, setOpen] = useState(true);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>('[data-nodd-story]'));
  }, []);

  return (
    <div style={{ minHeight: 520 }}>
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        threadsOpen={threads}
        threadsOtherState={[]}
        fetchResolved={async () => []}
        onItemOpen={() => {}}
        onItemHover={() => {}}
        userName="Alice Chen"
        onSignOut={() => {}}
        onHideForSession={() => {}}
        container={container}
      />
    </div>
  );
}

const meta: Meta<typeof SidebarStory> = {
  title: 'Nodd/Sidebar',
  component: SidebarStory,
};
export default meta;
type Story = StoryObj<typeof SidebarStory>;

export const WithThreads: Story = {};
export const Empty: Story = { args: { threads: [] } };
