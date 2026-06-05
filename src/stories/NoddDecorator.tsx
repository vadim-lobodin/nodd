import React, { useEffect, useState } from 'react';

// PinMarker CSS is scoped under [data-nodd-pin-container], which has its own
// theme tokens separate from [data-nodd-root]. We read the theme from the global
// decorator's [data-nodd-story] element so dark mode works via the background switcher.
export function PinContainer({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.querySelector('[data-nodd-story]');
    const update = () => {
      setTheme(root?.getAttribute('data-nodd-theme') === 'dark' ? 'dark' : 'light');
    };
    update();
    if (!root) return;
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ['data-nodd-theme'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div
      data-nodd-pin-container
      data-nodd-theme={theme}
      style={{ position: 'relative', height: 160, width: '100%' }}
    >
      {children}
    </div>
  );
}
