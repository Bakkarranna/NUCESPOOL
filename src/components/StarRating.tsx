import React, { useState } from 'react';
import { Star } from 'lucide-react';

const RATING_LABELS: Record<number, string> = {
  1: 'Rough',
  2: 'Fair',
  3: 'Decent',
  4: 'Solid',
  5: 'Elite',
};

interface StarRatingInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
}

export const StarRatingInput: React.FC<StarRatingInputProps> = ({
  label,
  value,
  onChange,
  size = 'md',
}) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? value;

  const iconCls =
    size === 'lg'
      ? 'h-7 w-7'
      : size === 'sm'
      ? 'h-4 w-4'
      : 'h-5 w-5';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        <span className="text-xs font-mono tabular-nums font-semibold text-amber-700">
          {active}/5 · {RATING_LABELS[active] || 'Solid'}
        </span>
      </div>
      <div
        className="inline-flex items-center gap-1"
        role="radiogroup"
        aria-label={label}
        onMouseLeave={() => setHovered(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= active;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`Rate ${label} ${star} out of 5 stars`}
              onMouseEnter={() => setHovered(star)}
              onClick={() => onChange(star)}
              className="p-1 rounded-lg hover:bg-amber-50 transition-transform active:scale-95 cursor-pointer"
            >
              <Star
                className={`${iconCls} transition-colors ${
                  filled
                    ? 'text-amber-500 fill-amber-400'
                    : 'text-slate-300 fill-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface StarRatingDisplayProps {
  rating: number | string;
  count?: number;
  size?: 'xs' | 'sm' | 'md';
  showNumeric?: boolean;
}

export const StarRatingDisplay: React.FC<StarRatingDisplayProps> = ({
  rating,
  count,
  size = 'sm',
  showNumeric = true,
}) => {
  const numeric = Math.max(0, Math.min(5, Number(rating) || 0));
  const rounded = Math.round(numeric);
  const iconCls =
    size === 'xs' ? 'h-3 w-3' : size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5" aria-label={`${numeric.toFixed(1)} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`${iconCls} ${
              star <= rounded
                ? 'text-amber-500 fill-amber-400'
                : 'text-slate-300 fill-transparent'
            }`}
          />
        ))}
      </span>
      {showNumeric && (
        <span className="text-xs font-mono tabular-nums font-semibold text-slate-800">
          {numeric.toFixed(1)}
        </span>
      )}
      {typeof count === 'number' && (
        <span className="text-xs text-slate-500">({count})</span>
      )}
    </span>
  );
};
