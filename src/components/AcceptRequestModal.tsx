import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Car, Check, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { RideRequestItem } from '../types';
import { Avatar } from './Avatar';

interface AcceptRequestModalProps {
  request: RideRequestItem | null;
  onClose: () => void;
  onAccepted: () => void;
  onOpenOfferSetup: () => void;
  onOpenProfile: () => void;
}

export const AcceptRequestModal: React.FC<AcceptRequestModalProps> = ({
  request,
  onClose,
  onAccepted,
  onOpenOfferSetup,
  onOpenProfile,
}) => {
  const { firebaseUser, profile, workspace, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();

  const [sourceChoice, setSourceChoice] = useState<string>('');
  const [farePerSeat, setFarePerSeat] = useState<number>(400);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifiedVehicles = useMemo(
    () =>
      (workspace?.vehicles ?? []).filter(
        (v) => profile?.isAdmin || v.verificationStatus === 'verified'
      ),
    [workspace?.vehicles, profile?.isAdmin]
  );

  const verifiedServices = useMemo(
    () =>
      (workspace?.transportServices ?? []).filter(
        (s) => profile?.isAdmin || s.verificationStatus === 'verified'
      ),
    [workspace?.transportServices, profile?.isAdmin]
  );

  const matchingActiveRides = useMemo(
    () =>
      (workspace?.providerRides ?? []).filter(
        (r) =>
          r.status === 'scheduled' &&
          request &&
          r.availableSeats >= request.seatsNeeded
      ),
    [workspace?.providerRides, request]
  );

  useEffect(() => {
    if (!request) return;
    setFarePerSeat(request.maxBudgetPerSeat || 400);
    setError(null);
    if (matchingActiveRides[0]) {
      setSourceChoice(`ride:${matchingActiveRides[0].id}`);
    } else if (verifiedVehicles[0]) {
      setSourceChoice(`vehicle:${verifiedVehicles[0].id}`);
    } else if (verifiedServices[0]) {
      setSourceChoice(`service:${verifiedServices[0].id}`);
    } else {
      setSourceChoice('');
    }
  }, [request, matchingActiveRides, verifiedVehicles, verifiedServices]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, onClose]);

  if (!request) return null;

  const isDriverCleared = Boolean(
    profile?.isAdmin ||
      (profile?.studentCardStatus === 'verified' &&
        profile?.cnicVerificationStatus === 'verified' &&
        (verifiedVehicles.length > 0 || verifiedServices.length > 0))
  );

  const hasTransportOption =
    matchingActiveRides.length > 0 ||
    verifiedVehicles.length > 0 ||
    verifiedServices.length > 0;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }
    if (!sourceChoice) {
      setError('Select a verified vehicle, carry service, or scheduled ride.');
      return;
    }

    const [kind, idStr] = sourceChoice.split(':');
    const id = Number(idStr);

    setSubmitting(true);
    try {
      await apiFetch(`/api/ride-requests/${request.id}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: kind === 'vehicle' ? id : null,
          transportServiceId: kind === 'service' ? id : null,
          existingRideId: kind === 'ride' ? id : null,
          farePerSeat,
        }),
      });
      await refreshAll();
      onAccepted();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to accept ride request.'
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
          <div>
            <div className="flex items-center gap-2 text-base font-bold text-slate-900 font-display">
              <span>{request.originCity}</span>
              <ArrowRight className="h-4 w-4 text-teal-700" />
              <span>{request.destinationCity}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {request.travelDate} · Needs {request.preferredTime} ·{' '}
              {request.seatsNeeded} seat(s) at {request.pickupPoint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Passenger Summary */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar
              name={request.passenger?.fullName}
              avatarUrl={request.passenger?.avatarUrl}
              size="md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <span className="truncate">
                  {request.passenger?.fullName || 'FAST Student'}
                </span>
                <ShieldCheck className="h-3.5 w-3.5 text-teal-700 shrink-0" />
              </div>
              <div className="text-xs text-slate-500 truncate">
                Max budget PKR {request.maxBudgetPerSeat}/seat
                {request.notes ? ` · "${request.notes}"` : ''}
              </div>
            </div>
          </div>
        </div>

        {!firebaseUser ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              Sign in with Google as a verified driver to pick up this student request.
            </p>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="w-full min-h-[44px] rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 cursor-pointer"
            >
              Sign in with Google
            </button>
          </div>
        ) : !isDriverCleared || !hasTransportOption ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-semibold">
              <Car className="h-4 w-4 text-amber-800 shrink-0" />
              <span>Driver Verification &amp; Vehicle Required</span>
            </div>
            <p>
              To pick up passenger requests, your Student ID Card, CNIC, and at least one vehicle or carry service must be verified by Campus Admin.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProfile();
                }}
                className="min-h-[38px] px-3.5 rounded-lg bg-white border border-amber-300 font-semibold text-amber-950 cursor-pointer"
              >
                Check Profile &amp; CNIC
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenOfferSetup();
                }}
                className="min-h-[38px] px-3.5 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer"
              >
                Add Vehicle / Carry
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConfirm} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Pick Up With
              </label>
              <select
                value={sourceChoice}
                onChange={(e) => setSourceChoice(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                {matchingActiveRides.map((r) => (
                  <option key={`ride:${r.id}`} value={`ride:${r.id}`}>
                    Existing Ride: {r.originCity} → {r.destinationCity} ({r.travelDate}{' '}
                    {r.departureTime} · {r.availableSeats} left)
                  </option>
                ))}
                {verifiedVehicles.map((v) => (
                  <option key={`vehicle:${v.id}`} value={`vehicle:${v.id}`}>
                    New Ride with {v.makeModel} ({v.registrationNumber})
                  </option>
                ))}
                {verifiedServices.map((s) => (
                  <option key={`service:${s.id}`} value={`service:${s.id}`}>
                    New Ride with {s.serviceName} ({s.registrationNumber})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Agreed Cash Share per Seat (PKR)
              </label>
              <input
                type="number"
                min={50}
                max={5000}
                step={50}
                required
                value={farePerSeat}
                onChange={(e) => setFarePerSeat(Number(e.target.value))}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Total for {request.seatsNeeded} seat(s): PKR{' '}
                {farePerSeat * request.seatsNeeded} (settled in cash on the ride).
              </p>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>
                {submitting
                  ? 'Confirming Pickup...'
                  : 'Confirm Pickup & Notify Passenger'}
              </span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
