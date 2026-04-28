import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Separator from '@radix-ui/react-separator';
import { MentionPicker, encodeMention, decodeMentions, type ProjectMember, type MentionReplacement } from './MentionPicker';
import { UserAvatar } from './UserAvatar';
import type { MemberProfile } from '../../store/types';

export type ThreadComment = {
  id: string;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
  pending?: boolean;
  failed?: boolean;
};

export type ThreadPopoverProps = {
  threadId: string;
  anchorX: number;
  anchorY: number;
  comments: ThreadComment[];
  currentUserId: string;
  resolved: boolean;
  members: MemberProfile[];
  onSubmitReply: (body: string, mentions: string[]) => Promise<void>;
  onToggleResolved: () => Promise<void>;
  onClose: () => void;
};

const GAP = 8;
const MARGIN = 8;
const POPOVER_WIDTH = 320;

function detectMentionTrigger(value: string, caret: number): { from: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === '@') {
      if (i === 0 || /[\s,(\[]/.test(value[i - 1])) {
        return { from: i, query: value.slice(i + 1, caret) };
      }
      return null;
    }
    if (!/[A-Za-z0-9_-]/.test(ch)) return null;
    i--;
  }
  return null;
}

function renderBodyWithMentions(body: string, memberMap: Map<string, MemberProfile>) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = /@\[([0-9a-f-]{36}):([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }
    const member = memberMap.get(match[1]);
    parts.push(
      <span key={match.index} className="align-mention-chip">
        @{member?.displayName ?? match[2]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }
  return parts;
}

export function ThreadPopover({
  threadId,
  anchorX,
  anchorY,
  comments,
  currentUserId,
  resolved,
  members,
  onSubmitReply,
  onToggleResolved,
  onClose,
}: ThreadPopoverProps) {
  const [draft, setDraft] = useState('');
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionFrom, setMentionFrom] = useState(0);
  const [caretRect, setCaretRect] = useState<DOMRect | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const keyboardHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);

  const memberMap = new Map(members.map(m => [m.userId, m]));
  const pickerMembers: ProjectMember[] = members.map(m => ({
    id: m.userId,
    display_name: m.displayName ?? m.email,
    email: m.email,
    avatar_url: m.avatarUrl ?? undefined,
  }));

  // Position
  const popoverX = anchorX + GAP + 28; // offset from pin
  const popoverY = anchorY;
  const clampedX = Math.min(popoverX, window.innerWidth - POPOVER_WIDTH - MARGIN);
  const clampedY = Math.max(MARGIN, popoverY);

  // Outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mentionPickerOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, mentionPickerOpen]);

  const handleTextareaInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const trigger = detectMentionTrigger(ta.value, ta.selectionStart ?? 0);
    if (trigger) {
      setMentionPickerOpen(true);
      setMentionQuery(trigger.query);
      setMentionFrom(trigger.from);
      // Compute caret rect (simplified)
      const rect = ta.getBoundingClientRect();
      setCaretRect(new DOMRect(rect.left + 8, rect.top + ta.offsetHeight - 20, 1, 16));
    } else {
      setMentionPickerOpen(false);
    }
  }, []);

  const handleMentionSelect = useCallback(
    (replacement: MentionReplacement) => {
      const before = draft.slice(0, replacement.from);
      const after = draft.slice(replacement.to);
      setDraft(before + replacement.insert + after);
      setDraftMentions(prev => [...new Set([...prev, replacement.member.id])]);
      setMentionPickerOpen(false);
      textareaRef.current?.focus();
    },
    [draft],
  );

  const handleSubmit = useCallback(async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmitReply(draft, draftMentions);
      setDraft('');
      setDraftMentions([]);
    } finally {
      setSubmitting(false);
    }
  }, [draft, draftMentions, submitting, onSubmitReply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionPickerOpen && keyboardHandlerRef.current) {
        if (keyboardHandlerRef.current(e.nativeEvent)) return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [mentionPickerOpen, handleSubmit],
  );

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      ref={popoverRef}
      className="align-popover"
      role="dialog"
      aria-labelledby={`align-thread-${threadId}`}
      style={{
        transform: `translate(${clampedX}px, ${clampedY}px)`,
        width: POPOVER_WIDTH,
      }}
    >
      <ScrollArea.Root className="align-popover-comments-scroll">
        <ScrollArea.Viewport className="align-popover-comments">
          {comments.map((comment, ci) => {
            const member = memberMap.get(comment.authorId);
            return (
              <div key={comment.id} className={`align-comment${comment.pending ? ' align-comment--pending' : ''}`}>
                <div className="align-comment-header">
                  <UserAvatar
                    name={member?.displayName ?? member?.email ?? '?'}
                    avatarUrl={member?.avatarUrl}
                    size={24}
                  />
                  <span className="align-comment-author">{member?.displayName ?? member?.email ?? 'Unknown'}</span>
                  <span className="align-comment-time">{formatTime(comment.createdAt)}</span>
                  {ci === 0 && (
                    <div className="align-popover-actions">
                      <button
                        className="align-btn align-btn--resolve"
                        onClick={onToggleResolved}
                      >
                        {resolved ? 'Reopen' : 'Resolve'}
                      </button>
                      <button className="align-btn align-btn--close" onClick={onClose} aria-label="Close">
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div className="align-comment-body">
                  {renderBodyWithMentions(comment.body, memberMap)}
                </div>
              </div>
            );
          })}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="align-scrollbar" orientation="vertical">
          <ScrollArea.Thumb className="align-scrollbar-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <Separator.Root className="align-separator" />

      <div className="align-popover-reply">
        <textarea
          ref={textareaRef}
          className="align-reply-input"
          placeholder="Reply... (@ to mention)"
          value={draft}
          onChange={e => { setDraft(e.target.value); handleTextareaInput(); }}
          onKeyDown={handleKeyDown}
          onClick={handleTextareaInput}
          rows={2}
        />
        <button
          className="align-btn align-btn--send"
          disabled={!draft.trim() || submitting}
          onClick={handleSubmit}
        >
          {submitting ? '...' : 'Send'}
        </button>
      </div>

      <MentionPicker
        open={mentionPickerOpen}
        query={mentionQuery}
        caretRect={caretRect}
        members={pickerMembers}
        recentCollaboratorIds={[]}
        onSelect={handleMentionSelect}
        onCancel={() => setMentionPickerOpen(false)}
        onKeyboardRef={handler => { keyboardHandlerRef.current = handler; }}
        triggerFrom={mentionFrom}
        triggerTo={textareaRef.current?.selectionStart ?? mentionFrom}
      />
    </div>
  );
}
