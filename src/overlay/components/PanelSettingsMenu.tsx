import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Settings, ViewOff, Logout, CheckmarkOutline } from '@carbon/icons-react';

export type PanelSettingsMenuProps = {
  /** Hide the overlay for the rest of this browser-tab session. */
  onHideForSession: () => void;
  /** Sign the current user out. Omit for logged-out viewers (no "Exit" item). */
  onSignOut?: () => void;
  /**
   * Comments-only: current resolved-visibility. When `onToggleShowResolved` is
   * provided, a "Show/Hide resolved comments" item appears. Omitted by the
   * Variants panel, where resolved comments have no meaning.
   */
  showResolved?: boolean;
  onToggleShowResolved?: () => void;
  /** Portal target — the overlay root, so the menu inherits scoped styles. */
  container?: HTMLElement | null;
};

/**
 * Gear menu shared by the Comments and Variants panel headers, so both panels
 * expose the same controls. Replaces the old standalone sign-out button:
 *   • "Hide for this session" — always available (guests included)
 *   • "Exit" — only when signed in (`onSignOut` provided)
 */
export function PanelSettingsMenu({
  onHideForSession,
  onSignOut,
  showResolved,
  onToggleShowResolved,
  container,
}: PanelSettingsMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="nodd-btn nodd-btn--close" aria-label="Settings" title="Settings">
          <Settings size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className="nodd-menu"
          align="end"
          sideOffset={6}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          {onToggleShowResolved && (
            <DropdownMenu.Item className="nodd-menu-item" onSelect={onToggleShowResolved}>
              <CheckmarkOutline size={16} />
              <span>{showResolved ? 'Hide resolved comments' : 'Show resolved comments'}</span>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className="nodd-menu-item" onSelect={onHideForSession}>
            <ViewOff size={16} />
            <span>Hide for this session</span>
          </DropdownMenu.Item>
          {onSignOut && (
            <>
              <DropdownMenu.Separator className="nodd-menu-separator" />
              <DropdownMenu.Item
                className="nodd-menu-item nodd-menu-item--danger"
                onSelect={onSignOut}
              >
                <Logout size={16} />
                <span>Exit</span>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
