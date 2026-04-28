import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Avatar from '@radix-ui/react-avatar';
import * as Separator from '@radix-ui/react-separator';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import type { MemberProfile } from '../../store/types';

export type ThreadSummary = {
  id: string;
  index: number;
  authorName: string;
  authorAvatarUrl?: string;
  snippet: string;
  createdAt: string;
  replyCount: number;
  resolved: boolean;
  unread: boolean;
};

export type SidebarProps = {
  open: boolean;
  onClose: () => void;
  threadsOpen: ThreadSummary[];
  fetchResolved: () => Promise<ThreadSummary[]>;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  container?: HTMLElement | null;
};

export function Sidebar({
  open,
  onClose,
  threadsOpen,
  fetchResolved,
  onItemOpen,
  onItemHover,
  container,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');
  const [resolvedItems, setResolvedItems] = useState<ThreadSummary[] | null>(null);
  const [resolvedStatus, setResolvedStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [search, setSearch] = useState('');

  const handleTabChange = useCallback(async (value: string) => {
    if (value === 'resolved') {
      setActiveTab('resolved');
      if (resolvedItems !== null) return;
      setResolvedStatus('loading');
      try {
        const items = await fetchResolved();
        setResolvedItems(items);
        setResolvedStatus('idle');
      } catch {
        setResolvedStatus('error');
      }
    } else {
      setActiveTab('open');
    }
  }, [fetchResolved, resolvedItems]);

  const items = activeTab === 'open' ? threadsOpen : (resolvedItems ?? []);
  const filtered = search
    ? items.filter(
        t =>
          t.snippet.toLowerCase().includes(search.toLowerCase()) ||
          t.authorName.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="align-sidebar-overlay" />
        <Dialog.Content
          className="align-sidebar"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <div className="align-sidebar-header">
            <Dialog.Title className="align-sidebar-title">Comments</Dialog.Title>
            <Dialog.Close asChild>
              <button className="align-btn align-btn--close" aria-label="Close sidebar">
                ✕
              </button>
            </Dialog.Close>
          </div>

          <Separator.Root className="align-separator" />

          <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
            <Tabs.List className="align-sidebar-tabs">
              <Tabs.Trigger value="open" className="align-sidebar-tab">
                Open ({threadsOpen.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="resolved" className="align-sidebar-tab">
                Resolved
              </Tabs.Trigger>
            </Tabs.List>

            <input
              className="align-sidebar-search"
              type="text"
              placeholder="Search comments..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />

            <Tabs.Content value="open" className="align-sidebar-tab-content" forceMount>
              {activeTab === 'open' && (
                <SidebarList
                  items={filtered}
                  loading={false}
                  emptyMessage="No comments on this page yet — add the first one."
                  formatTime={formatTime}
                  onItemOpen={onItemOpen}
                  onItemHover={onItemHover}
                />
              )}
            </Tabs.Content>
            <Tabs.Content value="resolved" className="align-sidebar-tab-content" forceMount>
              {activeTab === 'resolved' && (
                <SidebarList
                  items={filtered}
                  loading={resolvedStatus === 'loading'}
                  emptyMessage="Nothing here yet."
                  formatTime={formatTime}
                  onItemOpen={onItemOpen}
                  onItemHover={onItemHover}
                />
              )}
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SidebarList({
  items,
  loading,
  emptyMessage,
  formatTime,
  onItemOpen,
  onItemHover,
}: {
  items: ThreadSummary[];
  loading: boolean;
  emptyMessage: string;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
}) {
  return (
    <ScrollArea.Root className="align-sidebar-list-scroll">
      <ScrollArea.Viewport className="align-sidebar-list">
        {loading && (
          <div className="align-sidebar-loading">Loading...</div>
        )}
        {items.length === 0 && !loading && (
          <div className="align-sidebar-empty">{emptyMessage}</div>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className={`align-sidebar-item${item.unread ? ' align-sidebar-item--unread' : ''}`}
            onClick={() => onItemOpen(item.id)}
            onMouseEnter={() => onItemHover(item.id)}
            onMouseLeave={() => onItemHover(null)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onItemOpen(item.id)}
          >
            <div className="align-sidebar-item-header">
              <span className="align-sidebar-item-index">#{item.index}</span>
              <Avatar.Root className="align-avatar align-avatar--sm">
                <Avatar.Image
                  className="align-avatar-image"
                  src={item.authorAvatarUrl}
                  alt={item.authorName}
                />
                <Avatar.Fallback className="align-avatar-fallback" delayMs={0}>
                  {item.authorName[0]?.toUpperCase()}
                </Avatar.Fallback>
              </Avatar.Root>
              <span className="align-sidebar-item-author">{item.authorName}</span>
              <span className="align-sidebar-item-time">{formatTime(item.createdAt)}</span>
            </div>
            <div className="align-sidebar-item-snippet">{item.snippet}</div>
            {item.replyCount > 0 && (
              <span className="align-sidebar-item-replies">{item.replyCount} {item.replyCount === 1 ? 'reply' : 'replies'}</span>
            )}
          </div>
        ))}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="align-scrollbar" orientation="vertical">
        <ScrollArea.Thumb className="align-scrollbar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
