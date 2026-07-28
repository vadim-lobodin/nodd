import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { UserAvatar } from './UserAvatar';

// No email field: the `profiles` view stopped exposing addresses in migration
// 0007. `display_name` already falls back to the address' local part
// server-side, so name matching still catches an "@alice"-style query.
export interface ProjectMember {
  id: string;
  display_name: string;
  avatar_url?: string;
}

export interface MentionReplacement {
  from: number;
  to: number;
  insert: string;
  member: ProjectMember;
}

export interface MentionPickerProps {
  open: boolean;
  query: string;
  caretRect: DOMRect | null;
  members: ProjectMember[];
  recentCollaboratorIds: string[];
  onSelect: (replacement: MentionReplacement) => void;
  onCancel: () => void;
  onKeyboardRef: (handler: ((e: KeyboardEvent) => boolean) | null) => void;
  triggerFrom: number;
  triggerTo: number;
}

const MAX_RESULTS = 8;

export const MENTION_RE = /@\[([0-9a-f-]{36}):([^\]]+)\]/g;

export function encodeMention(m: ProjectMember): string {
  const safeName = m.display_name.replace(/]/g, ')');
  return `@[${m.id}:${safeName}]`;
}

export function decodeMentions(body: string): Array<{ id: string; name: string; index: number }> {
  const results: Array<{ id: string; name: string; index: number }> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');
  while ((match = re.exec(body)) !== null) {
    results.push({ id: match[1], name: match[2], index: match.index });
  }
  return results;
}

function filterAndRank(
  query: string,
  members: ProjectMember[],
  recentIds: string[],
): ProjectMember[] {
  const q = query.toLowerCase();
  if (q === '') {
    const recent = recentIds
      .map(id => members.find(m => m.id === id))
      .filter((m): m is ProjectMember => m != null);
    const rest = members
      .filter(m => !recentIds.includes(m.id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return [...recent, ...rest].slice(0, MAX_RESULTS);
  }

  const scored: Array<{ m: ProjectMember; bucket: number; recencyRank: number }> = [];
  for (const m of members) {
    const name = m.display_name.toLowerCase();
    let bucket: number;
    if (name.startsWith(q)) bucket = 0;
    else if (name.includes(q)) bucket = 1;
    else continue;
    scored.push({ m, bucket, recencyRank: recentIds.indexOf(m.id) });
  }
  scored.sort((a, b) =>
    a.bucket - b.bucket
    || (a.recencyRank === -1 ? 1 : 0) - (b.recencyRank === -1 ? 1 : 0)
    || a.recencyRank - b.recencyRank
    || a.m.display_name.localeCompare(b.m.display_name),
  );
  return scored.slice(0, MAX_RESULTS).map(s => s.m);
}

export function MentionPicker({
  open,
  query,
  caretRect,
  members,
  recentCollaboratorIds,
  onSelect,
  onCancel,
  onKeyboardRef,
  triggerFrom,
  triggerTo,
}: MentionPickerProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => filterAndRank(query, members, recentCollaboratorIds),
    [query, members, recentCollaboratorIds],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered]);

  const selectMember = useCallback(
    (member: ProjectMember) => {
      onSelect({
        from: triggerFrom,
        to: triggerTo,
        insert: encodeMention(member) + ' ',
        member,
      });
    },
    [onSelect, triggerFrom, triggerTo],
  );

  useEffect(() => {
    if (!open) {
      onKeyboardRef(null);
      return;
    }
    const handler = (e: KeyboardEvent): boolean => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(i => (i + 1) % filtered.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(i => (i - 1 + filtered.length) % filtered.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          selectMember(filtered[highlightedIndex]);
        }
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return true;
      }
      return false;
    };
    onKeyboardRef(handler);
    return () => onKeyboardRef(null);
  }, [open, filtered, highlightedIndex, onKeyboardRef, onCancel, selectMember]);

  if (!open || filtered.length === 0 || !caretRect) return null;

  const top = caretRect.bottom + 4;
  const left = caretRect.left;

  return (
    <div
      className="nodd-mention-picker"
      role="listbox"
      ref={listRef}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 2147483001,
      }}
    >
      {filtered.map((member, i) => (
        <div
          key={member.id}
          role="option"
          aria-selected={i === highlightedIndex}
          className={`nodd-mention-item ${i === highlightedIndex ? 'nodd-mention-item--active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            selectMember(member);
          }}
          onMouseEnter={() => setHighlightedIndex(i)}
        >
          <UserAvatar
            name={member.display_name}
            avatarUrl={member.avatar_url}
            size={24}
            className="nodd-mention-avatar"
          />
          <span className="nodd-mention-name">{member.display_name}</span>
        </div>
      ))}
    </div>
  );
}
