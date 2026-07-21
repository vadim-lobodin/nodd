import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Separator from '@radix-ui/react-separator';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Close, TrashCan } from '@carbon/icons-react';
import { UserAvatar } from './UserAvatar';
import { PanelSettingsMenu } from './PanelSettingsMenu';
import { formatRelativeTime } from '../relativeTime';
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
  /** True when the current user authored the thread and may delete it. */
  canDelete?: boolean;
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
  onItemDelete?: (threadId: string) => Promise<void> | void;
  container?: HTMLElement | null;
  userName?: string;
  /** Provided when signed in — surfaces the "Exit" item in the settings menu. */
  onSignOut?: () => void;
  /** Dismiss the overlay for this tab session (settings menu). */
  onHideForSession: () => void;
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
  onItemDelete,
  container,
  userName,
  onSignOut,
  onHideForSession,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');
  const [resolvedItems, setResolvedItems] = useState<ThreadSummary[] | null>(null);
  const [resolvedStatus, setResolvedStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const handleTabChange = useCallback(async (value: string) => {
    if (value === 'resolved') {
      setActiveTab('resolved');
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
  }, [fetchResolved]);

  const items = activeTab === 'open' ? threadsOpen : (resolvedItems ?? []);
  const groupedOther = groupByBreadcrumb(threadsOtherState);

  const formatTime = (iso: string) => formatRelativeTime(iso);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }} modal={false}>
      <Dialog.Portal container={container}>
        <Dialog.Content
          className="nodd-sidebar"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
        >
          <div className="nodd-sidebar-header">
            <Dialog.Title className="nodd-sidebar-title">Comments</Dialog.Title>
            <div className="nodd-sidebar-header-actions">
              <PanelSettingsMenu
                onHideForSession={onHideForSession}
                onSignOut={onSignOut}
                container={container}
              />
              <Dialog.Close asChild>
                <button className="nodd-btn nodd-btn--close" aria-label="Close sidebar">
                  <Close size={16} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
            <Tabs.List className="nodd-sidebar-tabs">
              <Tabs.Trigger value="open" className="nodd-sidebar-tab">
                Open ({threadsOpen.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="resolved" className="nodd-sidebar-tab">
                Resolved
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="open" className="nodd-sidebar-tab-content" forceMount>
              {activeTab === 'open' && (
                <ScrollArea.Root className="nodd-sidebar-list-scroll">
                  <ScrollArea.Viewport className="nodd-sidebar-list">
                    <SidebarSection
                      heading="On this page"
                      items={threadsOpen}
                      emptyMessage={threadsOtherState.length === 0 ? 'No comments on this page yet — add the first one.' : 'No comments visible in your current state.'}
                      formatTime={formatTime}
                      onItemOpen={onItemOpen}
                      onItemHover={onItemHover}
                      onItemDelete={onItemDelete}
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
                        onItemDelete={onItemDelete}
                        muted
                      />
                    ))}
                  </ScrollArea.Viewport>
                  <ScrollArea.Scrollbar className="nodd-scrollbar" orientation="vertical">
                    <ScrollArea.Thumb className="nodd-scrollbar-thumb" />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
              )}
            </Tabs.Content>
            <Tabs.Content value="resolved" className="nodd-sidebar-tab-content" forceMount>
              {activeTab === 'resolved' && (
                <SidebarList
                  items={items}
                  loading={resolvedStatus === 'loading'}
                  emptyMessage="Nothing here yet."
                  formatTime={formatTime}
                  onItemOpen={onItemOpen}
                  onItemHover={onItemHover}
                  onItemDelete={onItemDelete}
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
  onItemDelete,
}: {
  items: ThreadSummary[];
  loading: boolean;
  emptyMessage: string;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemDelete?: (threadId: string) => Promise<void> | void;
}) {
  return (
    <ScrollArea.Root className="nodd-sidebar-list-scroll">
      <ScrollArea.Viewport className="nodd-sidebar-list">
        {loading && (
          <div className="nodd-sidebar-loading">Loading...</div>
        )}
        {items.length === 0 && !loading && (
          <div className="nodd-sidebar-empty">{emptyMessage}</div>
        )}
        {items.map(item => (
          <SidebarItem key={item.id} item={item} formatTime={formatTime} onItemOpen={onItemOpen} onItemHover={onItemHover} onItemDelete={onItemDelete} />
        ))}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="nodd-scrollbar" orientation="vertical">
        <ScrollArea.Thumb className="nodd-scrollbar-thumb" />
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
  onItemDelete,
  muted,
}: {
  heading: string;
  items: ThreadSummary[];
  emptyMessage: string;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemActivate?: (threadId: string) => void;
  onItemDelete?: (threadId: string) => Promise<void> | void;
  muted?: boolean;
}) {
  if (items.length === 0 && !emptyMessage) return null;
  return (
    <div className={`nodd-sidebar-section${muted ? ' nodd-sidebar-section--muted' : ''}`}>
      {heading && <div className="nodd-sidebar-section-heading">{heading}</div>}
      {items.length === 0 ? (
        <div className="nodd-sidebar-empty">{emptyMessage}</div>
      ) : (
        items.map(item => (
          <SidebarItem
            key={item.id}
            item={item}
            formatTime={formatTime}
            onItemOpen={onItemOpen}
            onItemHover={onItemHover}
            onItemActivate={onItemActivate}
            onItemDelete={onItemDelete}
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
  onItemDelete,
}: {
  item: ThreadSummary;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemActivate?: (threadId: string) => void;
  onItemDelete?: (threadId: string) => Promise<void> | void;
}) {
  const handleOpen = () => {
    if (onItemActivate && item.canActivate) onItemActivate(item.id);
    else onItemOpen(item.id);
  };
  const showDelete = !!onItemDelete && item.canDelete;
  return (
    <div
      className={`nodd-sidebar-item${item.unread ? ' nodd-sidebar-item--unread' : ''}`}
      onClick={handleOpen}
      onMouseEnter={() => onItemHover(item.id)}
      onMouseLeave={() => onItemHover(null)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleOpen()}
    >
      <div className="nodd-sidebar-item-header">
        <UserAvatar
          name={item.authorName}
          avatarUrl={item.authorAvatarUrl}
          size={20}
          className="nodd-avatar--sm"
        />
        <span className="nodd-sidebar-item-author">{item.authorName}</span>
        <div className={`nodd-sidebar-item-meta${showDelete ? ' nodd-sidebar-item-meta--actionable' : ''}`}>
          <span className="nodd-sidebar-item-time">{formatTime(item.createdAt)}</span>
          {showDelete && (
            <button
              className="nodd-btn nodd-btn--delete nodd-sidebar-item-delete"
              onClick={e => { e.stopPropagation(); void onItemDelete?.(item.id); }}
              aria-label="Delete thread"
              title="Delete thread"
            >
              <TrashCan size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="nodd-sidebar-item-snippet">{item.snippet}</div>
      {item.replyCount > 0 && (
        <div className="nodd-sidebar-item-footer">
          <span className="nodd-sidebar-item-replies">{item.replyCount} {item.replyCount === 1 ? 'reply' : 'replies'}</span>
        </div>
      )}
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
