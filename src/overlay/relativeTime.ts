// Compact relative timestamps for comment/thread metadata. Keeps the header
// narrow (no clock time) — "just now", "5 minutes ago", "18 hours ago",
// "2 days ago", "3 weeks ago" — then falls back to a short absolute date for
// anything older than a month.
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const secs = Math.round((now - then) / 1000);
  if (secs < 45) return 'just now';

  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }

  const d = new Date(then);
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}
