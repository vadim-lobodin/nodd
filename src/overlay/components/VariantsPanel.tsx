import React, { useEffect, useReducer } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Close } from '@carbon/icons-react';
import { PanelSettingsMenu } from './PanelSettingsMenu';
import type { VariantDefinition, VariantRegistry } from '../../provider/variants';

export type VariantsPanelProps = {
  open: boolean;
  onClose: () => void;
  registry: VariantRegistry;
  container?: HTMLElement | null;
  /** Provided when signed in — surfaces the "Exit" item in the settings menu. */
  onSignOut?: () => void;
  /** Dismiss the overlay for this tab session (settings menu). */
  onHideForSession: () => void;
};

/** Re-render whenever the registry's definitions or selections change. */
function useRegistrySubscription(registry: VariantRegistry): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => registry.subscribe(force), [registry]);
}

export function VariantsPanel({ open, onClose, registry, container, onSignOut, onHideForSession }: VariantsPanelProps) {
  useRegistrySubscription(registry);

  const defs = registry.getDefinitions();
  const global: VariantDefinition[] = [];
  const page: VariantDefinition[] = [];
  for (const def of defs) {
    if (registry.resolveScope(def.key) === 'global') {
      global.push(def);
    } else if (def.mountCount > 0) {
      // A page-scoped definition mounted only on another page is not shown here.
      page.push(def);
    }
  }

  const isEmpty = global.length === 0 && page.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }} modal={false}>
      <Dialog.Portal container={container}>
        <Dialog.Content
          className="nodd-sidebar"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
        >
          <div className="nodd-sidebar-header">
            <Dialog.Title className="nodd-sidebar-title">Variants</Dialog.Title>
            <div className="nodd-sidebar-header-actions">
              <PanelSettingsMenu
                onHideForSession={onHideForSession}
                onSignOut={onSignOut}
                container={container}
              />
              <Dialog.Close asChild>
                <button className="nodd-btn nodd-btn--close" aria-label="Close variants">
                  <Close size={16} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <ScrollArea.Root className="nodd-sidebar-list-scroll">
            <ScrollArea.Viewport className="nodd-sidebar-list">
              {isEmpty ? (
                <div className="nodd-sidebar-empty">
                  No variants here. Declare them in code with <code>&lt;Variant&gt;</code> or{' '}
                  <code>useVariant()</code>.
                </div>
              ) : (
                <>
                  <VariantsSection heading="Global" defs={global} registry={registry} />
                  <VariantsSection heading="This page" defs={page} registry={registry} />
                </>
              )}
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar className="nodd-scrollbar" orientation="vertical">
              <ScrollArea.Thumb className="nodd-scrollbar-thumb" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function VariantsSection({
  heading,
  defs,
  registry,
}: {
  heading: string;
  defs: VariantDefinition[];
  registry: VariantRegistry;
}) {
  if (defs.length === 0) return null;
  return (
    <div className="nodd-sidebar-section">
      <div className="nodd-sidebar-section-heading">{heading}</div>
      {defs.map(def => (
        <VariantCard key={def.key} def={def} registry={registry} />
      ))}
    </div>
  );
}

function VariantCard({ def, registry }: { def: VariantDefinition; registry: VariantRegistry }) {
  const active = registry.getValue(def.key);
  return (
    <div className="nodd-variant-card">
      <div className="nodd-variant-label">{def.label ?? def.key}</div>
      <div className="nodd-variant-options" role="radiogroup" aria-label={def.label ?? def.key}>
        {def.options.map(option => {
          const isActive = option === active;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`nodd-sidebar-tab nodd-variant-option${isActive ? ' nodd-sidebar-tab--active' : ''}`}
              onClick={() => registry.setSelection(def.key, option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
