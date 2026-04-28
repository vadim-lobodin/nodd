import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Separator from '@radix-ui/react-separator';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { UserAvatar } from './UserAvatar';
import type { MemberProfile } from '../../store/types';

export type ThreadSummary = {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  snippet: string;
  createdAt: string;
  replyCount: number;
  resolved: boolean;
  unread: boolean;
  breadcrumb?: string;
  /** When set, an activator chain is available — sidebar shows a Show me button. */
  canActivate?: boolean;
  /** Stack used to activate; passed back to onItemActivate. */
  stateStack?: readonly string[];
};

export type SidebarProps = {
  open: boolean;
  onClose: () => void;
  threadsOpen: ThreadSummary[];
  threadsOtherState?: ThreadSummary[];
  fetchResolved: () => Promise<ThreadSummary[]>;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemActivate?: (threadId: string) => void;
  container?: HTMLElement | null;
};

export function Sidebar({
  open,
  onClose,
  threadsOpen,
  threadsOtherState = [],
  fetchResolved,
  onItemOpen,
  onItemHover,
  onItemActivate,
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
  const matchSearch = (t: ThreadSummary) =>
    t.snippet.toLowerCase().includes(search.toLowerCase()) ||
    t.authorName.toLowerCase().includes(search.toLowerCase()) ||
    (t.breadcrumb?.toLowerCase().includes(search.toLowerCase()) ?? false);
  const filtered = search ? items.filter(matchSearch) : items;
  const filteredOther = search ? threadsOtherState.filter(matchSearch) : threadsOtherState;
  const groupedOther = groupByBreadcrumb(filteredOther);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }} modal={false}>
      <Dialog.Portal container={container}>
        <Dialog.Content
          className="align-sidebar"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
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
                <ScrollArea.Root className="align-sidebar-list-scroll">
                  <ScrollArea.Viewport className="align-sidebar-list">
                    {threadsOtherState.length > 0 && (
                      <div className="align-sidebar-other-pill" aria-label={`${threadsOtherState.length} comments in other states`}>
                        Other states · {threadsOtherState.length}
                      </div>
                    )}
                    <SidebarSection
                      heading="On this page"
                      items={filtered}
                      emptyMessage={threadsOtherState.length === 0 ? 'No comments on this page yet — add the first one.' : 'No comments visible in your current state.'}
                      formatTime={formatTime}
                      onItemOpen={onItemOpen}
                      onItemHover={onItemHover}
                    />
                    {groupedOther.map(([breadcrumb, group]) => (
                      <SidebarSection
                        key={breadcrumb || '_'}
                        heading={breadcrumb}
                        items={group}
                        emptyMessage=""
                        formatTime={formatTime}
                        onItemOpen={onItemOpen}
                        onItemHover={onItemHover}
                        onItemActivate={onItemActivate}
                        muted
                      />
                    ))}
                  </ScrollArea.Viewport>
                  <ScrollArea.Scrollbar className="align-scrollbar" orientation="vertical">
                    <ScrollArea.Thumb className="align-scrollbar-thumb" />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
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
          <SidebarItem key={item.id} item={item} formatTime={formatTime} onItemOpen={onItemOpen} onItemHover={onItemHover} />
        ))}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="align-scrollbar" orientation="vertical">
        <ScrollArea.Thumb className="align-scrollbar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function SidebarSection({
  heading,
  items,
  emptyMessage,
  formatTime,
  onItemOpen,
  onItemHover,
  onItemActivate,
  muted,
}: {
  heading: string;
  items: ThreadSummary[];
  emptyMessage: string;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemActivate?: (threadId: string) => void;
  muted?: boolean;
}) {
  if (items.length === 0 && !emptyMessage) return null;
  return (
    <div className={`align-sidebar-section${muted ? ' align-sidebar-section--muted' : ''}`}>
      {heading && <div className="align-sidebar-section-heading">{heading}</div>}
      {items.length === 0 ? (
        <div className="align-sidebar-empty">{emptyMessage}</div>
      ) : (
        items.map(item => (
          <SidebarItem
            key={item.id}
            item={item}
            formatTime={formatTime}
            onItemOpen={onItemOpen}
            onItemHover={onItemHover}
            onItemActivate={onItemActivate}
          />
        ))
      )}
    </div>
  );
}

function SidebarItem({
  item,
  formatTime,
  onItemOpen,
  onItemHover,
  onItemActivate,
}: {
  item: ThreadSummary;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemActivate?: (threadId: string) => void;
}) {
  const showActivate = item.canActivate && !!onItemActivate;
  return (
    <div
      className={`align-sidebar-item${item.unread ? ' align-sidebar-item--unread' : ''}`}
      onClick={() => onItemOpen(item.id)}
      onMouseEnter={() => onItemHover(item.id)}
      onMouseLeave={() => onItemHover(null)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onItemOpen(item.id)}
    >
      <div className="align-sidebar-item-header">
        <UserAvatar
          name={item.authorName}
          avatarUrl={item.authorAvatarUrl}
          size={20}
          className="align-avatar--sm"
        />
        <span className="align-sidebar-item-author">{item.authorName}</span>
        <span className="align-sidebar-item-time">{formatTime(item.createdAt)}</span>
      </div>
      <div className="align-sidebar-item-snippet">{item.snippet}</div>
      <div className="align-sidebar-item-footer">
        {item.replyCount > 0 && (
          <span className="align-sidebar-item-replies">{item.replyCount} {item.replyCount === 1 ? 'reply' : 'replies'}</span>
        )}
        {showActivate && (
          <button
            className="align-sidebar-item-activate"
            onClick={e => { e.stopPropagation(); onItemActivate?.(item.id); }}
            aria-label="Open this state and show the comment"
          >
            Show me →
          </button>
        )}
      </div>
    </div>
  );
}

function groupByBreadcrumb(items: ThreadSummary[]): Array<[string, ThreadSummary[]]> {
  const map = new Map<string, ThreadSummary[]>();
  for (const item of items) {
    const key = item.breadcrumb ?? '';
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}
