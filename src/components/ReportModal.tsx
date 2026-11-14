import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const REPORT_CATEGORIES = [
  'Fake profile',
  'Incorrect vehicle information',
  'Misleading ride details',
  'Harassment',
  'Unsafe driving concerns',
  'No-show',
  'Unapproved fare changes',
  'Other misconduct',
];

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  rideId?: number;
  reportedUserId?: number;
  subjectLabel?: string;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  rideId,
  reportedUserId,
  subjectLabel,
}) => {
  const { apiFetch, firebaseUser, signInWithGoogle } = useAuth();
  const [category, setCategory] = useState(REPORT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          rideId,
          reportedUserId,
          category,
          description,
        }),
      });
      setFeedback('Report submitted to FAST-NUCES NUCESPOOL administrators for review.');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit report.');
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
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 shadow-xl cursor-default"
      >
        <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <h3 className="text-base font-semibold text-slate-900">
              Report Safety or Conduct Concern
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {subjectLabel && (
          <p className="mt-1 text-xs text-slate-500">Regarding: {subjectLabel}</p>
        )}

        {feedback ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-xl p-4">
              {feedback}
            </p>
            <button
              type="button"
              onClick={() => {
                setFeedback(null);
                onClose();
              }}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Report Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
              >
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Details
              </label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened so campus administrators can investigate..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>

            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
