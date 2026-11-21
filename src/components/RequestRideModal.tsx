import React, { useEffect, useState } from 'react';
import { BadgeCheck, HandHelping, MapPin, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface RequestRideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPublished: () => void;
  onOpenProfile: () => void;
}

export const RequestRideModal: React.FC<RequestRideModalProps> = ({
  isOpen,
  onClose,
  onPublished,
  onOpenProfile,
}) => {
  const { firebaseUser, profile, catalog, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();

  const routes = catalog?.routes ?? [];
  const [routeId, setRouteId] = useState<number>(routes[0]?.id ?? 1);
  const [originArea, setOriginArea] = useState('Satellite Town, Chiniot');
  const [destinationArea, setDestinationArea] = useState('FAST-NUCES CFD Campus');
  const [pickupPoint, setPickupPoint] = useState('Satellite Town Main Gate');
  const [travelDate, setTravelDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [preferredTime, setPreferredTime] = useState('07:45');
  const [returnTime, setReturnTime] = useState('15:30');
  const [journeyType, setJourneyType] = useState<'morning' | 'evening' | 'round_trip'>(
    'morning'
  );
  const [seatsNeeded, setSeatsNeeded] = useState(1);
  const [maxBudgetPerSeat, setMaxBudgetPerSeat] = useState(400);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routes.length > 0 && !routes.some((r) => r.id === routeId)) {
      setRouteId(routes[0].id);
    }
  }, [routes, routeId]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isStudentVerified = Boolean(
    profile?.isAdmin || profile?.studentCardStatus === 'verified'
  );

  const handleRouteChange = (nextId: number) => {
    setRouteId(nextId);
    const chosen = routes.find((r) => r.id === nextId);
    if (chosen) {
      if (chosen.originCity.toLowerCase().includes('faisalabad')) {
        setOriginArea('D-Ground / Canal Road, Faisalabad');
        setDestinationArea('FAST-NUCES CFD Campus');
        setPickupPoint('D-Ground / Kohinoor Chowk');
      } else {
        setOriginArea('Satellite Town, Chiniot');
        setDestinationArea('FAST-NUCES CFD Campus');
        setPickupPoint('Satellite Town Main Gate');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }
    if (!isStudentVerified) {
      setError(
        'Verify your FAST Student ID Card in Profile before publishing a ride request.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/ride-requests', {
        method: 'POST',
        body: JSON.stringify({
          routeId: routeId || routes[0]?.id || 1,
          originArea,
          destinationArea,
          pickupPoint,
          travelDate,
          preferredTime,
          returnTime: journeyType === 'morning' ? null : returnTime,
          journeyType,
          seatsNeeded,
          maxBudgetPerSeat,
          notes,
        }),
      });
      await refreshAll();
      setNotes('');
      onPublished();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to publish ride request.'
      );
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
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4 cursor-default"
      >
        <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-1 sm:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
              <HandHelping className="h-4 w-4 text-teal-700" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 font-display">
                Publish a Ride Request
              </h2>
              <p className="text-xs text-slate-500">
                Your request goes live to all verified drivers so they can pick you up.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close request modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Corridor Direction
              </label>
              <select
                value={routeId}
                onChange={(e) => handleRouteChange(Number(e.target.value))}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.corridorLabel}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Trip Timing
              </label>
              <select
                value={journeyType}
                onChange={(e) =>
                  setJourneyType(e.target.value as 'morning' | 'evening' | 'round_trip')
                }
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="morning">Morning</option>
                <option value="evening">Evening</option>
                <option value="round_trip">Round Trip</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Your Area
              </label>
              <input
                type="text"
                required
                value={originArea}
                onChange={(e) => setOriginArea(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Destination
              </label>
              <input
                type="text"
                required
                value={destinationArea}
                onChange={(e) => setDestinationArea(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Exact Pickup Stop
            </label>
            <div className="relative">
              <MapPin className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={pickupPoint}
                onChange={(e) => setPickupPoint(e.target.value)}
                placeholder="e.g., Kohinoor Chowk / Satellite Town Gate"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 pl-9 pr-3 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Travel Date
              </label>
              <input
                type="date"
                required
                value={travelDate}
                onChange={(e) => setTravelDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Preferred Time
              </label>
              <input
                type="time"
                required
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
              />
            </div>
            {journeyType !== 'morning' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Return Time
                </label>
                <input
                  type="time"
                  value={returnTime}
                  onChange={(e) => setReturnTime(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Seats Needed
                </label>
                <select
                  value={seatsNeeded}
                  onChange={(e) => setSeatsNeeded(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-mono tabular-nums"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} seat{n > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {journeyType !== 'morning' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Seats Needed
                </label>
                <select
                  value={seatsNeeded}
                  onChange={(e) => setSeatsNeeded(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-mono tabular-nums"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} seat{n > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={journeyType === 'morning' ? 'sm:col-span-2' : ''}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Max Cash Share per Seat (PKR)
              </label>
              <input
                type="number"
                min={50}
                max={5000}
                step={50}
                required
                value={maxBudgetPerSeat}
                onChange={(e) => setMaxBudgetPerSeat(Number(e.target.value))}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Note for Drivers (optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Need to reach before 8:30 AM lab, flexible by 15 mins."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm"
            />
          </div>

          {firebaseUser && !isStudentVerified && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <BadgeCheck className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  {profile?.studentCardStatus === 'pending'
                    ? 'Your FAST Student ID Card is pending review.'
                    : 'Upload your FAST Student ID Card in Profile before posting a request.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProfile();
                }}
                className="font-semibold underline whitespace-nowrap cursor-pointer"
              >
                Verify Card
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {!firebaseUser
              ? 'Sign in with Google to Post Request'
              : submitting
              ? 'Publishing Request...'
              : 'Publish Request to Drivers'}
          </button>
        </form>
      </div>
    </div>
  );
};
