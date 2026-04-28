import React, { useState, useCallback } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { UserAvatar } from './UserAvatar';

export type PinMarkerProps = {
  threadId: string;
  x: number;
  y: number;
  state: 'idle' | 'unread' | 'active';
  authorName?: string;
  authorAvatarUrl?: string;
  snippet?: string;
  tooltipContainer?: HTMLElement | null;
  onOpen: (threadId: string) => void;
  onHoverChange: (threadId: string | null) => void;
};

export function PinMarker({
  threadId,
  x,
  y,
  state: pinState,
  authorName,
  authorAvatarUrl,
  snippet,
  tooltipContainer,
  onOpen,
  onHoverChange,
}: PinMarkerProps) {
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    onHoverChange(threadId);
  }, [threadId, onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    onHoverChange(null);
  }, [onHoverChange]);

  const handleClick = useCallback(() => {
    onOpen(threadId);
  }, [threadId, onOpen]);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={`align-pin align-pin--${pinState}${hovered ? ' align-pin--hovered' : ''}`}
          data-align-pin-id={threadId}
          style={{ transform: `translate(${x}px, ${y}px)` }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          tabIndex={0}
          aria-label="Comment"
        />
      </Tooltip.Trigger>
      <Tooltip.Portal container={tooltipContainer ?? undefined}>
        <Tooltip.Content className="align-pin-tooltip" sideOffset={6}>
          <div className="align-pin-tooltip-bubble">
            {authorName && (
              <div className="align-pin-tooltip-header">
                <UserAvatar name={authorName} avatarUrl={authorAvatarUrl} size={18} />
                <span className="align-pin-tooltip-author">{authorName}</span>
              </div>
            )}
            {snippet && <p className="align-pin-tooltip-body">{snippet}</p>}
          </div>
          <Tooltip.Arrow className="align-pin-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
