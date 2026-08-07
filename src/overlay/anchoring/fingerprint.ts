const TEXT_TRUNCATE = 64;

export async function computeFingerprint(el: Element): Promise<string> {
  const tag = el.tagName;
  const classes = [...el.classList].sort().join('.');
  const text = (el.textContent ?? '').trim().slice(0, TEXT_TRUNCATE);
  const input = `${tag}|${classes}|${text}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** How far up the ancestor chain identity is recorded. */
const CONTEXT_DEPTH = 3;

/**
 * Fingerprints of an element's nearest ancestors, closest first.
 *
 * A control's own fingerprint is often not unique — a list of rows renders the
 * same "More" button on every one — and its selector can lean on `:nth-of-type`,
 * which silently points at a different row once the list is sorted or filtered.
 * The surrounding row *is* distinctive (it carries the title), so recording the
 * chain lets a moved control still be recognised, and a look-alike be rejected.
 *
 * Kept as a list rather than one combined hash because the levels differ in
 * value: the nearest ancestor moves with the control, while a container further
 * up changes whenever any sibling does. Matching walks outward and stops as soon
 * as the candidate is unambiguous.
 */
export function computeContextFingerprintSync(el: Element): string[] {
  const chain: string[] = [];
  let cur = el.parentElement;
  while (cur && cur !== el.ownerDocument.body && chain.length < CONTEXT_DEPTH) {
    chain.push(computeFingerprintSync(cur));
    cur = cur.parentElement;
  }
  return chain;
}

/** `<body>` / `<html>` — the page itself, as opposed to anything on it. */
export function isRootElement(el: Element): boolean {
  const doc = el.ownerDocument;
  return el === doc.body || el === doc.documentElement;
}

export function computeFingerprintSync(el: Element): string {
  // Fallback sync version using simple hash
  const tag = el.tagName;
  // The root elements contain the entire page, so hashing their text or classes
  // would change the fingerprint on any edit anywhere — and there is only ever
  // one of each, so the tag alone identifies them unambiguously.
  const root = isRootElement(el);
  const classes = root ? '' : [...el.classList].sort().join('.');
  const text = root ? '' : (el.textContent ?? '').trim().slice(0, TEXT_TRUNCATE);
  const input = `${tag}|${classes}|${text}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(40, '0');
}
