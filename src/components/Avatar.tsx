import React from 'react';

interface AvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarUrl,
  size = 'md',
}) => {
  const initials = (name || 'ST')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const sizeClass =
    size === 'sm'
      ? 'h-7 w-7 text-[11px]'
      : size === 'lg'
      ? 'h-16 w-16 text-lg'
      : 'h-9 w-9 text-xs';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name || 'Student profile'}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 shrink-0 bg-slate-100`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-semibold text-slate-700 shrink-0`}
    >
      {initials || 'ST'}
    </div>
  );
};
