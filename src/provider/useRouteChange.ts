import { isBrowser } from './ssr';

let patchCount = 0;
let originalPushState: typeof history.pushState | null = null;
let originalReplaceState: typeof history.replaceState | null = null;

function installHistoryPatch(): void {
  if (!isBrowser()) return;
  patchCount++;
  if (patchCount > 1) return; // already patched

  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);

  // Dispatch is deferred so subscribers' setState calls don't run inside React's
  // commit phase — Next's app-router calls history.pushState during commit,
  // and React 19 throws "useInsertionEffect must not schedule updates" if a
  // state update is triggered synchronously from there.
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState!(...args);
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('nodd:locationchange')));
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState!(...args);
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('nodd:locationchange')));
  };
}

function uninstallHistoryPatch(): void {
  patchCount--;
  if (patchCount > 0) return;
  if (originalPushState) history.pushState = originalPushState;
  if (originalReplaceState) history.replaceState = originalReplaceState;
  originalPushState = null;
  originalReplaceState = null;
}

export function subscribeToRouteChanges(onChange: (path: string) => void): () => void {
  if (!isBrowser()) return () => {};

  installHistoryPatch();

  const handler = () => onChange(window.location.pathname + window.location.search);

  window.addEventListener('popstate', handler);
  window.addEventListener('hashchange', handler);
  window.addEventListener('nodd:locationchange', handler);

  // Emit initial value
  onChange(window.location.pathname + window.location.search);

  return () => {
    window.removeEventListener('popstate', handler);
    window.removeEventListener('hashchange', handler);
    window.removeEventListener('nodd:locationchange', handler);
    uninstallHistoryPatch();
  };
}
