export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** True in a development build — gates console guidance meant for the host. */
export function isDevBuild(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}
