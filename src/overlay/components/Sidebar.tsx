import React, { useState, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
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
  /** Screen the thread lives on. Set for prototype-inbox items to enable
   *  cross-screen navigation (2c); the current screen opens it in place. */
  urlPath?: string;
  /** True when the current user authored the thread and may delete it. */
  canDelete?: boolean;
};

export type SidebarProps = {
  open: boolean;
  onClose: () => void;
  threadsOpen: ThreadSummary[];
  threadsOtherState?: ThreadSummary[];
  /**
   * Resolved-visibility, driven by the settings menu. Resolved threads are
   * merged into the live lists (dimmed) by the parent when this is on; the
   * sidebar only forwards the toggle and its state to the settings menu.
   */
  showResolved: boolean;
  onToggleShowResolved: () => void;
  /**
   * Open a thread. Restores the captured interactive state and, for a thread on
   * another screen (urlPath set), routes there first. One handler for every
   * entry point — on-page, other-state, and the prototype inbox.
   */
  onItemOpen: (threadId: string, urlPath?: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemDelete?: (threadId: string) => Promise<void> | void;
  container?: HTMLElement | null;
  userName?: string;
  /**
   * Label of the active prototype scope. When set, the sidebar shows a
   * "This screen | This prototype" toggle backed by fetchPrototypeThreads.
   */
  prototypeLabel?: string;
  /** Loads the per-prototype inbox (all screens). Required for the toggle. */
  fetchPrototypeThreads?: (opts: { resolved: boolean }) => Promise<ThreadSummary[]>;
};

type ScopeView = 'screen' | 'prototype';
type LoadState = { status: 'idle' | 'loading' | 'error'; items: ThreadSummary[] };

export function Sidebar({
  open,
  onClose,
  threadsOpen,
  threadsOtherState = [],
  showResolved,
  onToggleShowResolved,
  onItemOpen,
  onItemHover,
  onItemDelete,
  container,
  userName,
  prototypeLabel,
  fetchPrototypeThreads,
}: SidebarProps) {
  const scopeEnabled = !!prototypeLabel && !!fetchPrototypeThreads;
  const [scope, setScope] = useState<ScopeView>('screen');
  const [proto, setProto] = useState<LoadState>({ status: 'idle', items: [] });

  // The prototype inbox is fetch-on-open (not a live subscription), so load it
  // whenever the viewer switches into prototype scope or toggles resolved
  // visibility. Open threads always load; resolved are appended only when
  // "Show resolved" is on. An epoch guards against an out-of-order response
  // landing after the viewer has moved on. Screen scope uses the live props.
  const protoEpoch = useRef(0);
  useEffect(() => {
    if (!scopeEnabled || scope !== 'prototype') return;
    const epoch = ++protoEpoch.current;
    setProto(s => ({ status: 'loading', items: s.items }));
    void (async () => {
      try {
        const openItems = await fetchPrototypeThreads!({ resolved: false });
        const resolvedItems = showResolved ? await fetchPrototypeThreads!({ resolved: true }) : [];
        if (protoEpoch.current === epoch) {
          setProto({ status: 'idle', items: [...openItems, ...resolvedItems] });
        }
      } catch {
        if (protoEpoch.current === epoch) setProto(s => ({ status: 'error', items: s.items }));
      }
    })();
  }, [scopeEnabled, scope, showResolved, fetchPrototypeThreads]);

  // A scope no longer available (e.g. viewer left the prototype) must not strand
  // the sidebar on an empty prototype view.
  useEffect(() => {
    if (!scopeEnabled && scope !== 'screen') setScope('screen');
  }, [scopeEnabled, scope]);

  const isProto = scopeEnabled && scope === 'prototype';
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
                showResolved={showResolved}
                onToggleShowResolved={onToggleShowResolved}
                container={container}
              />
              <Dialog.Close asChild>
                <button className="nodd-btn nodd-btn--close" aria-label="Close sidebar">
                  <Close size={16} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {scopeEnabled && (
            <div className="nodd-sidebar-scope" role="tablist" aria-label="Comment scope">
              <button
                className={`nodd-sidebar-scope-btn${scope === 'screen' ? ' nodd-sidebar-scope-btn--active' : ''}`}
                role="tab"
                aria-selected={scope === 'screen'}
                onClick={() => setScope('screen')}
              >
                This screen
              </button>
              <button
                className={`nodd-sidebar-scope-btn${scope === 'prototype' ? ' nodd-sidebar-scope-btn--active' : ''}`}
                role="tab"
                aria-selected={scope === 'prototype'}
                onClick={() => setScope('prototype')}
                title={prototypeLabel}
              >
                This prototype
              </button>
            </div>
          )}

          {/* One list. Resolved threads are merged in (dimmed) by the parent
              when "Show resolved" is on — no tabs. */}
          {isProto ? (
            <PrototypeList
              state={proto}
              emptyMessage="No comments in this prototype yet."
              formatTime={formatTime}
              onItemOpen={onItemOpen}
              onItemHover={onItemHover}
              onItemDelete={onItemDelete}
            />
          ) : (
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PrototypeList({
  state,
  emptyMessage,
  formatTime,
  onItemOpen,
  onItemHover,
  onItemDelete,
}: {
  state: LoadState;
  emptyMessage: string;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string, urlPath?: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemDelete?: (threadId: string) => Promise<void> | void;
}) {
  // Group the whole prototype's threads by screen so the viewer can triage the
  // prototype end-to-end without visiting each screen. Keep showing the previous
  // items while a refetch is in flight to avoid a flash of empty state.
  const grouped = groupByBreadcrumb(state.items);
  return (
    <ScrollArea.Root className="nodd-sidebar-list-scroll">
      <ScrollArea.Viewport className="nodd-sidebar-list">
        {state.status === 'error' && state.items.length === 0 && (
          <div className="nodd-sidebar-empty">Couldn’t load the inbox. Try reopening it.</div>
        )}
        {state.status === 'loading' && state.items.length === 0 && (
          <div className="nodd-sidebar-loading">Loading...</div>
        )}
        {state.status !== 'loading' && state.items.length === 0 && (
          <div className="nodd-sidebar-empty">{emptyMessage}</div>
        )}
        {grouped.map(([breadcrumb, group]) => (
          <SidebarSection
            key={breadcrumb || '_'}
            heading={breadcrumb || 'This screen'}
            items={group}
            emptyMessage=""
            formatTime={formatTime}
            onItemOpen={onItemOpen}
            onItemHover={onItemHover}
            onItemDelete={onItemDelete}
          />
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
  onItemDelete,
  muted,
}: {
  heading: string;
  items: ThreadSummary[];
  emptyMessage: string;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string, urlPath?: string) => void;
  onItemHover: (threadId: string | null) => void;
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
  onItemDelete,
}: {
  item: ThreadSummary;
  formatTime: (iso: string) => string;
  onItemOpen: (threadId: string, urlPath?: string) => void;
  onItemHover: (threadId: string | null) => void;
  onItemDelete?: (threadId: string) => Promise<void> | void;
}) {
  const handleOpen = () => onItemOpen(item.id, item.urlPath);
  const showDelete = !!onItemDelete && item.canDelete;
  return (
    <div
      className={`nodd-sidebar-item${item.unread ? ' nodd-sidebar-item--unread' : ''}${item.resolved ? ' nodd-sidebar-item--resolved' : ''}`}
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
          <span className="nodd-sidebar-item-time">{item.resolved ? 'Resolved' : formatTime(item.createdAt)}</span>
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
