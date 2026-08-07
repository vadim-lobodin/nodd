import { useEffect, useRef } from 'react';
import { registerViewState, type ViewStateEntry } from './registry';

/**
 * Tell Nodd about a piece of view state, so a comment left in it can be
 * reopened there.
 *
 * Use it wherever the state already lives — no lifting, no store, no router:
 *
 * ```tsx
 * const [page, setPage] = useState(1);
 * useNoddViewState('page', page, setPage);
 * ```
 *
 * The value is snapshotted onto the pin when a comment is written and passed
 * back to `restore` before the thread is revealed. Nodd never inspects it, so
 * it can be anything JSON round-trips faithfully — a number, a filter object, a
 * scenario name. Anything it can't (a `Map`, a DOM node, a function) is
 * silently skipped rather than stored in a form that would come back different.
 *
 * Keys are per screen, which is all they need to be: a thread is revealed on
 * the `urlPath` it was written on, so two screens may both use `'page'`.
 *
 * `restore` may be async; reveal awaits it before re-anchoring. Returning a
 * promise that settles once the new content has rendered gives the best
 * results, but is not required — there is an anchor settle budget either way.
 *
 * Registering nothing is a supported choice. Without it a comment in a
 * swapped-out slice still opens, at the nearest surviving container, labelled
 * as approximate — it just can't be put back exactly.
 */
export function useNoddViewState<T>(
  key: string,
  value: T,
  restore: (value: T) => void | Promise<void>,
): void {
  // The registry holds the box, not the values, so a restore triggered long
  // after this render still calls the current setter and compares against the
  // current value. Writing during render is deliberate: it is a ref, and it has
  // to be current before any effect — including reveal's — can read it.
  //
  // The cast is the one unsound step, and it is the host's assertion to make:
  // they said this key holds a `T`, and reveal hands back whatever JSON was
  // stored under it. A blob from an older build can therefore be the wrong
  // shape, which is why `restore` throwing is contained per key.
  const entry = useRef<ViewStateEntry>({ current: { value, restore: restore as (v: unknown) => void } });
  entry.current.current = { value, restore: restore as (v: unknown) => void };

  useEffect(() => registerViewState(key, entry.current), [key]);
}
