import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Separator from '@radix-ui/react-separator';
import { MentionPicker, encodeMention, decodeMentions, type ProjectMember, type MentionReplacement } from './MentionPicker';
import { UserAvatar } from './UserAvatar';
import { ArrowUp, Checkmark, Close, Renew, TrashCan } from '@carbon/icons-react';
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
  onDeleteComment: (commentId: string) => Promise<void>;
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
      <span key={match.index} className="nodd-mention-chip">
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
  onDeleteComment,
  onClose,
}: ThreadPopoverProps) {
  const [draft, setDraft] = useState('');
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionFrom, setMentionFrom] = useState(0);
  const [caretRect, setCaretRect] = useState<DOMRect | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const keyboardHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(0);
  // Re-clamp on scroll/resize: the popover lives in the page-absolute pin
  // container, so its viewport bounds shift as the document scrolls.
  const [, forceTick] = useState(0);

  const memberMap = new Map(members.map(m => [m.userId, m]));
  const pickerMembers: ProjectMember[] = members.map(m => ({
    id: m.userId,
    display_name: m.displayName ?? m.email,
    email: m.email,
    avatar_url: m.avatarUrl ?? undefined,
  }));

  // Position — anchorX/Y are page-absolute (popover lives in the absolute
  // pin container so it scrolls with the document). Clamp on BOTH axes so the
  // whole popover stays inside the current viewport, flipping to the pin's
  // left side when there's no room on the right.
  const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  const innerW = typeof window !== 'undefined' ? window.innerWidth : 0;
  const innerH = typeof window !== 'undefined' ? window.innerHeight : 0;

  const PIN_OFFSET = GAP + 28; // clear the pin marker
  const rightEdge = scrollX + innerW - POPOVER_WIDTH - MARGIN;
  const preferredX = anchorX + PIN_OFFSET;
  // If the preferred (right-of-pin) placement overflows, try flipping to the
  // left of the pin before falling back to a hard clamp against the edge.
  const flippedX = anchorX - POPOVER_WIDTH - GAP;
  const popoverX =
    preferredX <= rightEdge ? preferredX : flippedX >= scrollX + MARGIN ? flippedX : rightEdge;
  const clampedX = Math.max(scrollX + MARGIN, Math.min(popoverX, rightEdge));

  // Measured height keeps the bottom edge inside the viewport; fall back to the
  // CSS cap (min(60vh, 480px)) before the first measurement.
  const maxHeight = Math.min(innerH * 0.6, 480);
  const effectiveHeight = popoverHeight || maxHeight;
  const bottomEdge = scrollY + innerH - effectiveHeight - MARGIN;
  const clampedY = Math.max(scrollY + MARGIN, Math.min(anchorY, bottomEdge));

  // Measure the popover so the bottom edge can be clamped inside the viewport.
  // The ResizeObserver re-measures as the comment list grows, keeping the
  // reply box on-screen.
  useEffect(() => {
    const el = popoverRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPopoverHeight(el.offsetHeight));
    ro.observe(el);
    setPopoverHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // Re-clamp when the viewport bounds shift under us.
  useEffect(() => {
    const onChange = () => forceTick(t => t + 1);
    window.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

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
    setSubmitError(false);
    try {
      await onSubmitReply(draft, draftMentions);
      setDraft('');
      setDraftMentions([]);
    } catch {
      // The store rolled back the optimistic comment. Keep the draft so the
      // user can retry instead of silently losing what they typed.
      setSubmitError(true);
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
      className="nodd-popover"
      role="dialog"
      aria-labelledby={`nodd-thread-${threadId}`}
      style={{
        transform: `translate(${clampedX}px, ${clampedY}px)`,
        width: POPOVER_WIDTH,
      }}
    >
      {comments.length > 0 && (
      <ScrollArea.Root className="nodd-popover-comments-scroll">
        <ScrollArea.Viewport className="nodd-popover-comments">
          {comments.map((comment, ci) => {
            const member = memberMap.get(comment.authorId);
            const canDelete = comment.authorId === currentUserId && !comment.pending;
            return (
              <div key={comment.id} className={`nodd-comment${comment.pending ? ' nodd-comment--pending' : ''}`}>
                <div className="nodd-comment-header">
                  <UserAvatar
                    name={member?.displayName ?? member?.email ?? '?'}
                    avatarUrl={member?.avatarUrl}
                    size={24}
                  />
                  <span className="nodd-comment-author">{member?.displayName ?? member?.email ?? 'Unknown'}</span>
                  <span className="nodd-comment-time">{formatTime(comment.createdAt)}</span>
                  {(ci === 0 || canDelete) && (
                    <div className="nodd-popover-actions">
                      {canDelete && (
                        <button
                          className="nodd-btn nodd-btn--delete"
                          onClick={() => setConfirmDeleteId(comment.id)}
                          aria-label="Delete"
                          title={ci === 0 ? 'Delete thread' : 'Delete comment'}
                        >
                          <TrashCan size={16} />
                        </button>
                      )}
                      {ci === 0 && (
                        <>
                          <button
                            className="nodd-btn nodd-btn--resolve"
                            onClick={onToggleResolved}
                            aria-label={resolved ? 'Reopen' : 'Resolve'}
                            title={resolved ? 'Reopen' : 'Resolve'}
                          >
                            {resolved ? <Renew size={16} /> : <Checkmark size={16} />}
                          </button>
                          <button className="nodd-btn nodd-btn--close" onClick={onClose} aria-label="Close">
                            <Close size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="nodd-comment-body">
                  {renderBodyWithMentions(comment.body, memberMap)}
                </div>
                {confirmDeleteId === comment.id && (
                  <div className="nodd-comment-confirm" role="alertdialog" aria-label="Confirm delete">
                    <span className="nodd-comment-confirm-text">
                      {ci === 0 ? 'Delete this whole thread?' : 'Delete this comment?'}
                    </span>
                    <div className="nodd-comment-confirm-actions">
                      <button
                        className="nodd-btn nodd-btn--ghost"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="nodd-btn nodd-btn--danger"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          void onDeleteComment(comment.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="nodd-scrollbar" orientation="vertical">
          <ScrollArea.Thumb className="nodd-scrollbar-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
      )}

      {submitError && (
        <div className="nodd-popover-error" role="alert">
          Couldn’t send — check your connection and try again.
        </div>
      )}

      <div className="nodd-popover-reply">
        <textarea
          ref={textareaRef}
          autoFocus
          className="nodd-reply-input"
          placeholder={comments.length === 0 ? 'Add a comment' : 'Reply...'}
          value={draft}
          onChange={e => { setDraft(e.target.value); setSubmitError(false); handleTextareaInput(); }}
          onKeyDown={handleKeyDown}
          onClick={handleTextareaInput}
          rows={1}
        />
        <button
          className="nodd-btn nodd-btn--send"
          disabled={!draft.trim() || submitting}
          onClick={handleSubmit}
          aria-label="Send"
        >
          <ArrowUp size={16} />
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
