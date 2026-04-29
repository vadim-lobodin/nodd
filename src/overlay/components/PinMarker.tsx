import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

const HOVER_DELAY_MS = 400;
const TOOLTIP_OFFSET = 6;
const TOOLTIP_WIDTH = 280;

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
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<number | null>(null);

  const showTooltip = pinState !== 'active' && hovered && tooltipOpen;

  // Delay the tooltip open like Radix's delayDuration
  useEffect(() => {
    if (!hovered) {
      if (openTimer.current !== null) {
        window.clearTimeout(openTimer.current);
        openTimer.current = null;
      }
      setTooltipOpen(false);
      return;
    }
    openTimer.current = window.setTimeout(() => {
      setTooltipOpen(true);
      openTimer.current = null;
    }, HOVER_DELAY_MS);
    return () => {
      if (openTimer.current !== null) {
        window.clearTimeout(openTimer.current);
        openTimer.current = null;
      }
    };
  }, [hovered]);

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

  // Tooltip position — anchored to the trigger's viewport rect so it tracks
  // both scroll and reflow without coupling to the pin's transform.
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!showTooltip) {
      setTooltipPos(null);
      return;
    }
    const update = () => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Match ThreadPopover anchor: top-aligned with pin, sitting to its right.
      const left = Math.min(
        r.right + TOOLTIP_OFFSET,
        window.innerWidth - TOOLTIP_WIDTH - 8,
      );
      const top = Math.max(8, r.top);
      setTooltipPos({ left, top });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showTooltip, x, y]);

  return (
    <>
      <button
        ref={buttonRef}
        className={`align-pin align-pin--${pinState}${hovered ? ' align-pin--hovered' : ''}`}
        data-align-pin-id={threadId}
        style={{ transform: `translate(${x}px, ${y}px)` }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        tabIndex={0}
        aria-label="Comment"
      />
      {showTooltip && tooltipPos && tooltipContainer && createPortal(
        <div
          className="align-pin-tooltip"
          style={{ position: 'fixed', left: tooltipPos.left, top: tooltipPos.top, width: TOOLTIP_WIDTH, pointerEvents: 'none' }}
        >
          <div className="align-pin-tooltip-bubble">
            {authorName && (
              <div className="align-pin-tooltip-header">
                <UserAvatar name={authorName} avatarUrl={authorAvatarUrl} size={18} />
                <span className="align-pin-tooltip-author">{authorName}</span>
              </div>
            )}
            {snippet && <p className="align-pin-tooltip-body">{snippet}</p>}
          </div>
        </div>,
        tooltipContainer,
      )}
    </>
  );
}
