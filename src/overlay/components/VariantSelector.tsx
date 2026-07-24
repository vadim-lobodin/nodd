import React from 'react';

export type VariantSelectorProps = {
  label: string;
  options: readonly string[];
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Compact grayscale selector used for switching between prototype variants.
 */
export function VariantSelector({
  label,
  options,
  value,
  onValueChange,
}: VariantSelectorProps) {
  return (
    <div className="nodd-variant-card">
      <div className="nodd-variant-label">{label}</div>
      <div className="nodd-variant-options" role="radiogroup" aria-label={label}>
        {options.map(option => {
          const isSelected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`nodd-sidebar-tab nodd-variant-option${isSelected ? ' nodd-variant-option--selected' : ''}`}
              onClick={() => onValueChange(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
