import React from 'react';
import BoringAvatar from 'boring-avatars';

const PALETTE = ['#4f46e5', '#7c3aed', '#2563eb', '#0891b2', '#059669'];

export type UserAvatarProps = {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
};

export function UserAvatar({ name, avatarUrl, size = 24, className }: UserAvatarProps) {
  if (avatarUrl) {
    return (
      <img
        className={`nodd-avatar ${className ?? ''}`}
        src={avatarUrl}
        alt=""
        loading="lazy"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`nodd-avatar ${className ?? ''}`}
      style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
    >
      <BoringAvatar
        size={size}
        name={name}
        variant="beam"
        colors={PALETTE}
      />
    </span>
  );
}
