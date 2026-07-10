import React, { useState, useRef, useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { VariantsPanel } from '../overlay/components/VariantsPanel';
import { createVariantRegistry, type VariantRegistry } from '../provider/variants';

// VariantsPanel uses Radix Dialog.Portal — it portals into `container`, which
// must be inside [data-nodd-root] for CSS to apply. Mirrors Sidebar.stories.
function VariantsPanelStory({ withVariants = true }: { withVariants?: boolean }) {
  const [open, setOpen] = useState(true);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const registryRef = useRef<VariantRegistry | null>(null);
  if (!registryRef.current) registryRef.current = createVariantRegistry({ projectId: 'story' });
  const registry = registryRef.current;

  useEffect(() => {
    if (!withVariants) return;
    // A global variant (declared scope) + two page variants mounted on "/".
    const un1 = registry.register(
      { key: 'checkout-layout', options: ['single-page', 'wizard'], label: 'Checkout layout', scope: 'global' },
      '/',
    );
    const un2 = registry.register(
      { key: 'hero', options: ['minimal', 'bold'], label: 'Hero style' },
      '/',
    );
    const un3 = registry.register(
      { key: 'density', options: ['comfortable', 'compact'], label: 'Density' },
      '/',
    );
    return () => { un1(); un2(); un3(); };
  }, [registry, withVariants]);

  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>('[data-nodd-story]'));
    return () => registry.dispose();
  }, [registry]);

  return (
    <div style={{ minHeight: 520 }}>
      <VariantsPanel
        open={open}
        onClose={() => setOpen(false)}
        registry={registry}
        container={container}
        onHideForSession={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof VariantsPanelStory> = {
  title: 'Nodd/VariantsPanel',
  component: VariantsPanelStory,
};
export default meta;
type Story = StoryObj<typeof VariantsPanelStory>;

export const GlobalAndPage: Story = {};
export const Empty: Story = { args: { withVariants: false } };
