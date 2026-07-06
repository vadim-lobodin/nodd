import React, { type ReactNode } from 'react';
import { NoddState } from '../state/NoddState';
import { useVariant } from './useVariant';
import type { VariantScope } from './registry';

export type VariantProps = {
  name: string;
  /** Option name → JSX block. The active block is rendered. */
  options: Record<string, ReactNode>;
  /** Panel display name. Falls back to `name`. */
  label?: string;
  /** Forces the Global section regardless of how many pages mount it. */
  scope?: VariantScope;
};

/**
 * Swap whole JSX blocks by variant. Sugar over `useVariant` plus a
 * `<NoddState name={`${name}:${active}`}>` wrapper — that wrapper is what makes
 * comments placed inside the block variant-aware (their `state_key` records the
 * active option, so the pin hides when a different option is shown).
 *
 * The `display: contents` wrapper from NoddState means zero layout impact.
 */
export function Variant({ name, options, label, scope }: VariantProps) {
  const keys = Object.keys(options);
  const active = useVariant(name, keys, { label, scope });
  return (
    <NoddState name={`${name}:${active}`}>
      {options[active] ?? options[keys[0]]}
    </NoddState>
  );
}
