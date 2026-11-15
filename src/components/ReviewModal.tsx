import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { BookingItem } from '../types';
import { Avatar } from './Avatar';
import { StarRatingInput } from './StarRating';

const FEEDBACK_CHIPS = [
  'Bang on time',
  'Smooth driving',
  'AC chilled',
  'Zero drama',
  'Clean ride',
  'Good comms',
];

interface ReviewModalProps {
  booking: BookingItem | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  booking,
  onClose,
  onSubmitted,
}) => {
  const { apiFetch, refreshAll } = useAuth();
  const [overallRating, setOverallRating] = useState(5);
  const [punctualityRating, setPunctualityRating] = useState(5);
  const [communicationRating, setCommunicationRating] = useState(5);
  const [experienceRating, setExperienceRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverallRating(5);
    setPunctualityRating(5);
    setCommunicationRating(5);
    setExperienceRating(5);
    setComment('');
    setError(null);
    setSubmitting(false);
  }, [booking?.id]);

  useEffect(() => {
    if (!booking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [booking, onClose]);

  if (!booking) return null;

  const appendChip = (chip: string) => {
    setComment((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip;
      if (trimmed.toLowerCase().includes(chip.toLowerCase())) return prev;
      return `${trimmed}, ${chip.toLowerCase()}`;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: booking.id,
          overallRating,
          punctualityRating,
          communicationRating,
          experienceRating,
          comment: comment.trim(),
        }),
      });
      await refreshAll();
      setComment('');
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4 cursor-pointer"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-5 cursor-default"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar
              name={booking.provider?.fullName}
              avatarUrl={booking.provider?.avatarUrl}
              size="md"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 font-display">
                  Rate Your Driver &amp; Ride Vibe
                </h3>
                {booking.status === 'completed' && (
                  <span className="px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-[10px] font-semibold uppercase text-teal-800">
                    Ride Completed
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {booking.provider?.fullName || 'Driver'} ·{' '}
                {booking.ride
                  ? `${booking.ride.originCity} → ${booking.ride.destinationCity} (${booking.ride.travelDate})`
                  : `Booking #${booking.id}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5">
          Quick ratings keep rides reliable on the Chiniot ↔ Faisalabad run.
        </p>

        {/* Overall Big Star Rating */}
        <div className="rounded-xl bg-amber-50/60 border border-amber-200/80 p-4">
          <StarRatingInput
            label="Overall Driver Rating"
            value={overallRating}
            onChange={setOverallRating}
            size="lg"
          />
        </div>

        {/* Sub-category Star Ratings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
            <StarRatingInput
              label="Punctuality"
              value={punctualityRating}
              onChange={setPunctualityRating}
              size="sm"
            />
          </div>
          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
            <StarRatingInput
              label="Communication"
              value={communicationRating}
              onChange={setCommunicationRating}
              size="sm"
            />
          </div>
          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
            <StarRatingInput
              label="Ride Comfort"
              value={experienceRating}
              onChange={setExperienceRating}
              size="sm"
            />
          </div>
        </div>

        {/* Quick Feedback Chips + Comment Box */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700">
              Short Feedback (optional)
            </label>
            <span className="text-[11px] font-mono text-slate-400">
              {comment.length}/300
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => appendChip(chip)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-teal-50 hover:border-teal-300 text-[11px] font-medium text-slate-700 cursor-pointer"
              >
                + {chip}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            maxLength={300}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Left right on time, AC was working, zero drama..."
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-700"
          />
        </div>

        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="sm:w-32 min-h-[46px] rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            Skip for Now
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 min-h-[46px] rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Posting Rating & Feedback...' : 'Submit Rating & Feedback'}
          </button>
        </div>
      </form>
    </div>
  );
};
