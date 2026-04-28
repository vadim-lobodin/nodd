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

export function computeFingerprintSync(el: Element): string {
  // Fallback sync version using simple hash
  const tag = el.tagName;
  const classes = [...el.classList].sort().join('.');
  const text = (el.textContent ?? '').trim().slice(0, TEXT_TRUNCATE);
  const input = `${tag}|${classes}|${text}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(40, '0');
}
