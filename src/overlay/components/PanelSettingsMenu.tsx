import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { OverflowMenuHorizontal, CheckmarkOutline } from '@carbon/icons-react';

export type PanelSettingsMenuProps = {
  /** Current resolved-visibility. */
  showResolved: boolean;
  /** Toggle whether resolved comments are shown (dimmed) across the overlay. */
  onToggleShowResolved: () => void;
  /** Portal target — the overlay root, so the menu inherits scoped styles. */
  container?: HTMLElement | null;
};

/**
 * Gear menu in the Comments panel header. Its only control is the
 * resolved-comments toggle; global actions (hide, log out) live in the toolbar
 * chevron menu instead.
 */
export function PanelSettingsMenu({
  showResolved,
  onToggleShowResolved,
  container,
}: PanelSettingsMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="nodd-btn nodd-btn--close" aria-label="Settings" title="Settings">
          <OverflowMenuHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className="nodd-menu"
          align="end"
          sideOffset={6}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <DropdownMenu.Item className="nodd-menu-item" onSelect={onToggleShowResolved}>
            <CheckmarkOutline size={16} />
            <span>{showResolved ? 'Hide resolved comments' : 'Show resolved comments'}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
