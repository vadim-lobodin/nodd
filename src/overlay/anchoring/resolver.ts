import { computeFingerprintSync } from './fingerprint';

export const FUZZY_FINGERPRINT_THRESHOLD = 6;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export type ResolveResult = { element: Element; tier: 1 | 2 | 3 } | null;

export function resolvePin(pin: { selector: string; fingerprint: string }): ResolveResult {
  // Tier 1 — Selector path
  try {
    const matches = document.querySelectorAll(pin.selector);
    if (matches.length === 1) {
      const fp = computeFingerprintSync(matches[0]);
      if (fp === pin.fingerprint) {
        return { element: matches[0], tier: 1 };
      }
    }
    if (matches.length > 0) {
      // Check fingerprints of all matches
      let fpMatch: Element | null = null;
      let fpMatchCount = 0;
      for (const m of matches) {
        if (computeFingerprintSync(m) === pin.fingerprint) {
          fpMatch = m;
          fpMatchCount++;
        }
      }
      if (fpMatchCount === 1 && fpMatch) {
        return { element: fpMatch, tier: 1 };
      }
    }
  } catch {
    // Invalid selector — fall through to Tier 2
  }

  // Tier 2 — Fuzzy fingerprint match
  try {
    const lastSegment = pin.selector.split('>').pop()?.trim() ?? '';
    const tagMatch = lastSegment.match(/^([a-z][a-z0-9]*)/i);
    const tagName = tagMatch?.[1] ?? 'div';
    const candidates = document.querySelectorAll(tagName);

    let bestEl: Element | null = null;
    let bestDist = Infinity;

    for (const candidate of candidates) {
      const fp = computeFingerprintSync(candidate);
      const dist = levenshtein(fp, pin.fingerprint);
      if (dist < bestDist) {
        bestDist = dist;
        bestEl = candidate;
      }
    }

    if (bestEl && bestDist <= FUZZY_FINGERPRINT_THRESHOLD) {
      return { element: bestEl, tier: 2 };
    }
  } catch {
    // Fall through to Tier 3
  }

  // Tier 3 — Orphan
  return null;
}
