import React, { forwardRef } from 'react';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export type NoddInputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Minimal text input for Nodd-owned forms. Visual states stay grayscale and
 * deliberately avoid pill shapes, tinted fills, and focus glows.
 */
export const NoddInput = forwardRef<HTMLInputElement, NoddInputProps>(
  function NoddInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={classes('nodd-input', className)}
        {...props}
      />
    );
  },
);

export type NoddButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
};

/**
 * Minimal button for Nodd-owned forms. It shares the same compact geometry as
 * NoddInput and has no elevation or color tint.
 */
export const NoddButton = forwardRef<HTMLButtonElement, NoddButtonProps>(
  function NoddButton(
    { className, variant = 'primary', fullWidth = false, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={classes(
          'nodd-button',
          `nodd-button--${variant}`,
          fullWidth && 'nodd-button--full',
          className,
        )}
        {...props}
      />
    );
  },
);
