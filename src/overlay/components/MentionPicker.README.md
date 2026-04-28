# MentionPicker

> `@`-mention autocomplete listbox attached to the reply input inside `ThreadPopover`. Tracks the caret, filters and ranks project members, and inserts a sentinel-encoded mention token that downstream renderers turn into a chip.

Related: [OverlayRenderer](../README.md) · [Align — Architecture Design](../../../DESIGN_DOC.md) · [CommentStore](../../store/README.md)

## 1. Purpose

`MentionPicker` is the only place in Align where users address other people. It must:

1. **Pop open exactly when the user means to mention someone** — typing `@` at a word boundary, never inside an email or mid-word.
2. **Stay glued to the caret** as the user types, scrolls inside the textarea, or resizes the popover.
3. **Surface the right person fast** — match-quality first, recent collaborators as a tiebreaker, with sub-50 ms keystroke-to-render.
4. **Produce a faithful, machine-readable mention token** that survives a round-trip through Postgres and renders as a chip everywhere.

It is **internal** to the `@align/react` package, used today only by `ThreadPopover` but designed for reuse by any future Align input that accepts mentions (inline edit of an existing comment, sidebar quick-reply, etc.).

## 2. Why this is a separate sub-module

| Reason | Detail |
|--------|--------|
| **Non-trivial algorithm** | Caret-position tracking on a `<textarea>` requires a hidden mirror element; ranking combines two signals; mention-token round-trip needs a stable sentinel. None of these belong in `OverlayRenderer.tsx`. |
| **Reusable** | Three planned consumers in v1.x: reply input (now), inline comment edit, sidebar quick-reply. Each gets a different host element (`<textarea>` vs. contenteditable) but identical picker behaviour. |
| **Independent test surface** | The picker can be unit-tested with a fake `getProjectMembers()` and a fake input; no overlay portal needed. |

## 3. Public Interface

`MentionPicker` is a controlled React component. Its host (the reply input) owns the textarea state and feeds the picker its current value + caret. The picker emits replacement instructions; it never mutates the input directly.

```ts
export interface MentionPickerProps {
  /** The input element the picker is attached to. Required for caret math. */
  inputRef: RefObject<HTMLTextAreaElement | HTMLElement>;

  /** Current text content of the input (for textarea) or innerText (for contenteditable). */
  value: string;

  /** Current caret offset within `value`. */
  caret: number;

  /** Project member directory; usually `CommentStore.getProjectMembers()`. */
  members: ProjectMember[];

  /** Recent-collaboration ranking signal; usually `CommentStore.getRecentCollaborators(projectId)`. */
  recentCollaboratorIds: string[];

  /** Called when the user picks a member. Host applies the replacement to its own state. */
  onSelect: (replacement: MentionReplacement) => void;

  /** Called when the picker closes for any reason (Esc, outside click, no `@` trigger anymore). */
  onDismiss?: () => void;
}

export interface MentionReplacement {
  /** Inclusive start of the range to replace in `value` (the `@`). */
  from: number;
  /** Exclusive end of the range to replace (caret position when picked). */
  to: number;
  /** Text to insert. Always ends with a trailing space. */
  insert: string;          // e.g. "@[a3f1c2:Vadim Lobodin] "
  /** The picked member, for the host to push into `mentions[]`. */
  member: ProjectMember;
}

export interface ProjectMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string;
}
```

The picker exposes **no imperative API**. State (open/closed, highlighted index, query) is fully derived from props (`value`, `caret`) and internal cursor selection.

## 4. Output Contract

| Output | Guarantee |
|--------|-----------|
| Listbox DOM | Rendered into the same Align portal as `ThreadPopover`; ARIA `role="listbox"` with `aria-activedescendant`. `pointer-events: auto`. |
| Position | Listbox top-left = caret rect bottom-left + 4 px; flips above the caret if it would overflow the viewport. |
| `onSelect` | Fired exactly once per user pick. The replacement string ends with a single space so the user can keep typing. |
| `onDismiss` | Fired exactly once when the picker transitions from open → closed without a selection. |
| Side effects | None on the host page. The picker reads `inputRef.current.getBoundingClientRect()` and (for textarea) appends/removes a single hidden mirror `<div>` under `[data-align-root]`; no host-DOM mutation. |

## 5. Internal Structure

```mermaid
graph TD
  Props[Props: value, caret, members] --> Trigger[detectTrigger]
  Trigger -->|@query| Filter[filterAndRank]
  Filter --> List[Listbox UI]
  Trigger -->|null| Closed[Render null]
  InputRef[inputRef] --> Caret[caretRect]
  Caret --> Position[positionListbox]
  List --> Position
  KeyHandler[Host keydown handler via ref] --> List
  List -->|Enter/Tab| Emit[onSelect MentionReplacement]
```

The component is built from five pure functions plus one React component:

| File | Responsibility |
|------|----------------|
| `MentionPicker.tsx` | React component; orchestrates the four pure helpers and renders the listbox. |
| `detectTrigger.ts` | Given `(value, caret)`, returns `{ from, query } \| null` if a valid `@`-trigger is active. |
| `filterAndRank.ts` | Given `(query, members, recentCollaboratorIds)`, returns members sorted by match quality then recency. |
| `caretRect.ts` | Given `(inputEl, caret)`, returns a viewport-relative `DOMRect` of the caret. Hybrid strategy (§7). |
| `mentionToken.ts` | Encode/decode the sentinel format `@[user_id:Display Name]`. |
| `useKeyboardNav.ts` | Hook: registers keydown on `inputRef` for ↑/↓/Enter/Tab/Esc; returns highlighted index. |

## 6. Trigger Detection

A trigger is active iff, walking left from `caret` in `value`:

1. We encounter at least one character.
2. The first character we encounter that is **not** `[A-Za-z0-9_-]` (the "query" charset) must be `@`.
3. The character immediately to the left of that `@` must be one of: start-of-string, whitespace, `\n`, or one of `,`, `(`, `[` (sentence punctuation that legitimately precedes a mention).

If matched, `from = index of @`, `query = value.slice(from + 1, caret)`. The trigger closes if the user types whitespace, navigates the caret outside `[from, caret]`, or deletes the `@`.

This rule deliberately excludes:

- Mid-word `@` (e.g. inside an email — `vadim@align.dev` will not trigger because the char to the left of `@` is alphanumeric).
- `@` immediately followed by a non-query char (e.g. `@!`).

## 7. Caret Position — Hybrid Strategy

The picker must place the listbox at the caret. Browsers expose no direct API for `<textarea>` caret coordinates, so we use a hybrid:

### 7.1 `<textarea>` — hidden mirror

```
1. Lazily create one <div data-align-mention-mirror> under [data-align-root].
2. Copy all computed styles that affect text layout from the textarea:
   font, letter-spacing, line-height, padding, border, box-sizing, white-space:pre-wrap,
   word-wrap:break-word, width (set to textarea client width).
3. Position it offscreen (left: -9999px; top: 0; visibility: hidden).
4. Set its textContent to value.slice(0, caret), then append a zero-width <span id="caret-marker">.
5. Read marker.getBoundingClientRect() → relative-to-mirror.
6. Add textarea.getBoundingClientRect() origin and subtract textarea.scrollTop / scrollLeft.
7. Result is the caret's viewport rect.
```

The mirror is created once per picker mount, kept alive across keystrokes, and torn down on unmount.

### 7.2 Contenteditable — native Range

```
1. const sel = window.getSelection();
2. const range = sel.getRangeAt(0).cloneRange();
3. range.collapse(true);
4. const rects = range.getClientRects();
5. Use rects[0] (or fallback: insert temporary <span>, measure, remove).
```

The `caretRect.ts` helper exports a single function that branches on `inputRef.current instanceof HTMLTextAreaElement`.

### 7.3 Listbox placement

Given the caret rect:

```
preferred = { top: caret.bottom + 4, left: caret.left };
if preferred.top + listboxHeight > viewport.height:
  use { top: caret.top - listboxHeight - 4, left: caret.left };  // flip above
clamp left to [8, viewport.width - listboxWidth - 8];
```

`transform: translate(...)` is used (not `top/left`) to stay on the compositor thread, matching OverlayRenderer §16.

## 8. Filtering & Ranking

```ts
function filterAndRank(query, members, recentIds) {
  const q = query.toLowerCase();
  if (q === '') {
    // Empty query: show recent collaborators first, then alphabetical.
    return [
      ...recentIds.map(id => members.find(m => m.id === id)).filter(Boolean),
      ...members
        .filter(m => !recentIds.includes(m.id))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    ].slice(0, MAX_RESULTS);
  }

  const scored = [];
  for (const m of members) {
    const name = m.display_name.toLowerCase();
    const email = m.email.toLowerCase();
    let bucket;
    if (name.startsWith(q) || email.startsWith(q))      bucket = 0;  // prefix
    else if (name.includes(q) || email.includes(q))     bucket = 1;  // substring
    else continue;                                                   // miss
    const recencyRank = recentIds.indexOf(m.id);                     // -1 if none
    scored.push({ m, bucket, recencyRank });
  }
  scored.sort((a, b) =>
    a.bucket - b.bucket
    || (a.recencyRank === -1 ? 1 : 0) - (b.recencyRank === -1 ? 1 : 0)
    || a.recencyRank - b.recencyRank
    || a.m.display_name.localeCompare(b.m.display_name)
  );
  return scored.slice(0, MAX_RESULTS).map(s => s.m);
}
```

`MAX_RESULTS = 8`. Ranking signals, in order:

1. **Match quality** — prefix > substring > miss (misses excluded).
2. **Recency** — members in `recentCollaboratorIds` outrank those not in it.
3. **Recency rank** — earlier in the list = more recent collaboration.
4. **Display name** — alphabetical tiebreaker.

The function is pure, synchronous, and called on every keystroke. It is O(N · |query|); for the v1 cap of 50 members per project, this is ~3 µs.

## 9. Keyboard Navigation

`useKeyboardNav` attaches a `keydown` listener to `inputRef.current` (capture phase) while the picker is open:

| Key | Action |
|-----|--------|
| `ArrowDown` | Highlight next; wrap. `preventDefault`. |
| `ArrowUp` | Highlight previous; wrap. `preventDefault`. |
| `Enter` | Select highlighted; `preventDefault` so the textarea does not insert a newline. |
| `Tab` | Select highlighted; `preventDefault` to avoid focus loss. |
| `Escape` | Close picker; `preventDefault`. Caret and content unchanged. |
| Any other | No-op. The host's normal input handling proceeds, `value`/`caret` change, the picker re-evaluates the trigger. |

When closed, the hook detaches all listeners. Highlighted index is clamped on every prop change.

## 10. Mention Token Format

The chosen v1 representation is **plain text with a sentinel** in the textarea, rendered as a chip in read-only views:

```
@[<user_id>:<Display Name>]
```

- `<user_id>` is the UUID from `ProjectMember.id`.
- `<Display Name>` is the literal display name at insert-time (any `]` in the name is replaced with `)`; we never embed escapes).
- The token is followed by exactly one space when inserted.

Rationale: a `<textarea>` cannot host inline non-editable elements, and switching the entire input to contenteditable (just for chips) brings substantial cross-browser pain — selection bugs, paste-handling, IME quirks. The sentinel survives copy/paste, is trivially regex-replaced into chips at render time, and is round-trip-stable through `comments.body` in Postgres.

`mentionToken.ts` exports:

```ts
export const MENTION_RE = /@\[([0-9a-f-]{36}):([^\]]+)\]/g;

export function encodeMention(m: ProjectMember): string {
  const safeName = m.display_name.replace(/]/g, ')');
  return `@[${m.id}:${safeName}]`;
}

export function decodeMentions(body: string): Array<{ id: string; name: string; index: number }> {
  // for renderers
}
```

Read-only renderers (comment list inside `ThreadPopover`, sidebar snippet) replace each match with a chip element; raw `body` round-trips unchanged.

## 11. Data Structures

| Type | Origin | Used for |
|------|--------|----------|
| `ProjectMember` | `CommentStore.getProjectMembers()` | Directory; rendered in listbox. |
| `recentCollaboratorIds: string[]` | `CommentStore.getRecentCollaborators(projectId)` (cached, see DESIGN_DOC §8.5) | Tiebreaker ranking; ordered most-recent first. |
| `MentionReplacement` | Emitted by picker | Host applies to textarea + pushes `member.id` into `comments.mentions[]`. |
| Trigger state | Internal | `{ from: number; query: string } \| null`. |

## 12. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Sentinel-encoded plain text in textarea, chip on render** | A `<textarea>` cannot host non-editable inline elements. A sentinel (`@[id:name]`) survives copy/paste, persists losslessly to Postgres, and is rendered as a chip everywhere read-only. Avoids switching to contenteditable, which is a known source of selection/IME bugs. |
| **Hybrid caret-rect strategy** | `<textarea>` exposes no caret API → hidden-mirror is the standard technique and correct across fonts/wrapping. Contenteditable has a native `Range`-based API that is faster and exact; using both lets the same picker serve both input types in v1.1. |
| **Single hidden mirror per picker mount** | Building the mirror on every keystroke would be wasteful; keeping it alive lets us only update `textContent` (cheap). Torn down on unmount so it never leaks across portals. |
| **Prefix > substring, then recency** | Match quality is the dominant signal users expect; using recency only as a tiebreaker prevents the surprising case where a stale collaborator outranks an obvious prefix match. The parent spec calls out "ranked by recent collaboration" — this preserves that intent without breaking match-quality expectations. |
| **`MAX_RESULTS = 8`** | Empirically the sweet spot between coverage and visual weight; the listbox stays under one screen of a popover at typical sizes. |
| **Picker is fully controlled (`value` + `caret` props)** | The host owns input state. The picker is then trivially testable with a fake input and works identically for textarea and contenteditable hosts. |
| **`onSelect` returns a replacement, picker never mutates the input** | Keeps the picker reusable across input implementations (uncontrolled textarea, controlled textarea, contenteditable). The host applies the edit in whatever way matches its state model. |
| **Trigger detection requires a non-query char (or BOS) before `@`** | This is what excludes mid-email `@`s (`vadim@align.dev`) and accidental triggers in URLs/handles already in the text. |
| **Listbox in the same Align portal as `ThreadPopover`** | One CSS scope, one z-index, one outside-click handler. The picker positions itself in viewport coordinates, so portal nesting is irrelevant. |

## 13. File Layout

```
src/overlay/components/
├── MentionPicker.tsx              ← React component, this spec's surface
├── MentionPicker.README.md        ← this document
├── mention/
│   ├── detectTrigger.ts           ← (value, caret) → { from, query } | null
│   ├── filterAndRank.ts           ← (query, members, recentIds) → ProjectMember[]
│   ├── caretRect.ts               ← hybrid caret-rect (textarea | contenteditable)
│   ├── mentionToken.ts← encode/decode @[id:name]
│   ├── useKeyboardNav.ts          ← keydown hook
│   └── __tests__/                 ← unit tests for each pure helper
└── MentionPicker.test.tsx         ← integration test with fake input
```

## 14. Performance Budget

| Operation | Target | Notes |
|-----------|--------|-------|
| Trigger detection per keystroke | < 50 µs | Single linear scan back from caret. |
| Filter+rank (50 members) | < 100 µs | O(N · |query|) plus an N·log N sort. |
| Caret rect (textarea, mirror update) | < 1 ms | Single `textContent` set + one `getBoundingClientRect`. |
| Listbox render | < 5 ms on a mid-tier laptop | 8 rows max. |
| Keystroke → listbox repaint | < 16 ms | One frame. Stays well under OverlayRenderer's 200 ms perceived-response budget. |

## 15. Known Limitations

- **No grouping by team / external** in v1; everyone in `getProjectMembers()` is a flat list. A future enhancement could add section headers.
- **No keyboard-only opening** without typing `@`. There is no "@-button" UI. Acceptable for v1; a v1.1 toolbar button could insert `@` programmatically and the trigger-detector handles it identically.
- **Sentinel collisions**: if a user literally types `@[uuid:Name]` by hand, it will render as a chip even though no real selection happened. Acceptable: cosmetic only, no security implication, exact-uuid match makes accidental occurrence near-zero.
- **IME composition**: keystrokes during composition (CJK input) do not advance the trigger query; the picker waits for `compositionend` before re-evaluating. This means transient flicker on composing — acceptable, matches how Slack and Linear behave.
- **Pasting a member name** does not auto-mention. The user must type `@` to opt in. Avoids surprise mentions from copy/paste of comment text.

## 16. Sub-Modules to Document Next

None planned. The five helpers in `mention/` are small enough to be covered by inline JSDoc; if `caretRect.ts` or `filterAndRank.ts` grows substantially they would be split into their own submodule specs.

## 17. Links

- **Parent:** [OverlayRenderer](../README.md)
- **Depends on:** [CommentStore](../../store/README.md) (`getProjectMembers`, `getRecentCollaborators`)
- **References:** DESIGN_DOC §3 (comment schema, `mentions[]`), §8.5 (member directory caching), OverlayRenderer §12 (mention picker behaviour), §16 (compositor-thread positioning)
