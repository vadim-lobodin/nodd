// Host view state — the one thing Nodd genuinely cannot work out for itself.
//
// A comment left on row 3 of page 4 of a list disappears the moment the list
// goes back to page 1. So does one left on a screen showing the "connected"
// scenario when the demo resets to "disconnected". The anchor isn't hidden and
// it isn't stale — it does not exist, because the host is rendering a different
// slice of the same UI.
//
// Everything else in `state/` works by reading the DOM: a role, a layout, an
// ARIA link. There is nothing in the DOM that says "a function called setPage
// exists and passing it 4 would bring this row back". No amount of cleverness
// recovers that, and the obvious shortcuts are worse than the problem — putting
// view state in the URL is a host-architecture mandate a library has no
// business making, and replaying whichever control was pressed last is exactly
// the press-the-wrong-thing failure `resolveRef` exists to prevent.
//
// So this is the one place Nodd asks the host for something. The ask is
// deliberately small and local: one line at the site of the state itself, no
// lifting, no store, no router.
//
//     const [page, setPage] = useState(1);
//     useNoddViewState('page', page, setPage);
//
// Whatever is registered gets snapshotted onto the pin at capture time and
// replayed before reveal re-anchors. Nodd never interprets the value — it is an
// opaque JSON blob owned entirely by the host.
//
// Registration is module-level, like the activator registry, so a value stays
// restorable across the re-renders and remounts that restoring it causes.

/**
 * A registered slice of host view state, held as a mutable box so the registry
 * always sees the current render's value and setter — a restore can happen days
 * after the render that registered it.
 */
export type ViewStateEntry = {
  current: { value: unknown; restore: (value: unknown) => void | Promise<void> };
};

const entries = new Map<string, ViewStateEntry>();

export function registerViewState(key: string, entry: ViewStateEntry): () => void {
  entries.set(key, entry);
  return () => {
    if (entries.get(key) === entry) entries.delete(key);
  };
}

/**
 * A value is only worth recording if it survives a round trip through the
 * database, which stores the pin as JSON. Anything else — a Map, a DOM node, a
 * function, a circular object — is dropped rather than stored in a form that
 * would come back subtly different.
 */
function serialisable(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value); // NaN and Infinity both come back as null
    case 'object':
      break;
    default:
      return false; // undefined, function, symbol, bigint
  }

  const obj = value as object;
  if (seen.has(obj)) return false; // a cycle — JSON.stringify would throw
  seen.add(obj);

  if (Array.isArray(obj)) return obj.every(v => serialisable(v, seen));

  // Anything with its own prototype — Map, Set, Date, a class instance —
  // *does* survive `JSON.stringify`, but comes back as something else: `{}`,
  // a string. A value that round-trips into a different thing is worse than
  // one we declined to store, because the host's `restore` would be handed it
  // as if it were real. Only plain objects are recorded.
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return false;

  return Object.values(obj).every(v => serialisable(v, seen));
}

/** Snapshot every registered slice, or nothing if the host registered none. */
export function captureViewState(): Record<string, unknown> | undefined {
  const snapshot: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    const { value } = entry.current;
    if (serialisable(value)) snapshot[key] = value;
  }
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export type RestoreResult = {
  /** Keys whose value was applied because it differed from the current one. */
  restored: string[];
  /**
   * Keys the pin recorded that nothing is registered for any more — the host
   * renamed or removed that slice since the comment was written. Reported
   * rather than thrown: a stale blob from an older build must degrade, not
   * break reveal.
   */
  missing: string[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Put the host back into the slice a comment was written in.
 *
 * Values already matching are skipped, so revealing a comment on the screen
 * you're already looking at doesn't churn the host's state. A `restore` that
 * throws is contained to its own key: the other slices still apply, and the
 * caller finds out by re-resolving the anchor rather than by trusting a
 * success flag.
 */
export async function applyViewState(
  snapshot: Record<string, unknown> | undefined,
): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], missing: [] };
  if (!snapshot) return result;

  for (const [key, value] of Object.entries(snapshot)) {
    const entry = entries.get(key);
    if (!entry) {
      result.missing.push(key);
      continue;
    }
    if (same(entry.current.value, value)) continue;
    try {
      await entry.current.restore(value);
      result.restored.push(key);
    } catch {
      // The host's own restore failed. Nothing useful to say to the viewer that
      // the re-anchor attempt won't say better.
      result.missing.push(key);
    }
  }
  return result;
}

/** Test seam — the registry is module state, so suites must be able to reset it. */
export function clearViewStateRegistry(): void {
  entries.clear();
}
