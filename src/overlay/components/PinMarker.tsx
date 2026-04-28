import React, { useState, useCallback } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

export type PinMarkerProps = {
  threadId: string;
  index: number;
  x: number;
  y: number;
  state: 'idle' | 'unread' | 'active';
  authorAvatarUrl?: string;
  snippet?: string;
  onOpen: (threadId: string) => void;
  onHoverChange: (threadId: string | null) => void;
};

export function PinMarker({
  threadId,
  index,
  x,
  y,
  state: pinState,
  snippet,
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
          aria-label={`Comment ${index}`}
        >
          {index}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="align-pin-tooltip" sideOffset={6}>
          <span className="align-pin-tooltip-label">Comment #{index}</span>
          {snippet && <span className="align-pin-tooltip-snippet">{snippet}</span>}
          <Tooltip.Arrow className="align-pin-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
