import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bus,
  Calculator,
  Car,
  Flag,
  MapPin,
  MessageSquareText,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { calculateDailyCostSplit } from '../lib/matching';
import type { RideItem } from '../types';
import { Avatar } from './Avatar';
import { ReportModal } from './ReportModal';
import { ReviewModal } from './ReviewModal';
import { StarRatingDisplay } from './StarRating';

interface RideDetailModalProps {
  ride: RideItem | null;
  onClose: () => void;
  onBooked: () => void;
  onOpenProfile?: () => void;
}

export const RideDetailModal: React.FC<RideDetailModalProps> = ({
  ride,
  onClose,
  onBooked,
  onOpenProfile,
}) => {
  const { firebaseUser, profile, workspace, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();
  const [seatsRequested, setSeatsRequested] = useState(1);
  const [pickupPoint, setPickupPoint] = useState('');
  const [passengerNote, setPassengerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  useEffect(() => {
    setSeatsRequested(1);
    setPickupPoint('');
    setPassengerNote('');
    setError(null);
    setSuccessMsg(null);
    setSubmitting(false);
  }, [ride?.id]);

  useEffect(() => {
    if (!ride || showReport || showReviewModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ride, showReport, showReviewModal, onClose]);

  const stops = useMemo(() => {
    if (!ride) return [];
    return ride.pickupPoints
      .split('·')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [ride]);

  const effectivePickup = pickupPoint || stops[0] || ride?.originArea || '';

  const splitPreview = useMemo(() => {
    if (!ride) return null;
    return calculateDailyCostSplit({
      estimatedTotalCost: ride.estimatedTotalCost,
      totalSeatsOffered: ride.totalSeatsOffered,
      availableSeats: ride.availableSeats,
      costMethod: ride.costMethod,
      includeDriverInSplit: ride.includeDriverInSplit,
      additionalSeats: seatsRequested,
    });
  }, [ride, seatsRequested]);

  if (!ride || !splitPreview) return null;

  const isOwnRide = profile?.id === ride.providerUserId;
  const isStudentCardVerified = Boolean(
    profile?.isAdmin || profile?.studentCardStatus === 'verified'
  );
  const reviewsList = ride.providerReviews ?? [];
  const eligibleBookingToReview = workspace?.myBookings.find(
    (b) =>
      b.rideId === ride.id &&
      ['completed', 'accepted'].includes(b.status) &&
      !b.hasReviewed
  );

  const avgPunctuality =
    reviewsList.length > 0
      ? (
          reviewsList.reduce((sum, r) => sum + r.punctualityRating, 0) /
          reviewsList.length
        ).toFixed(1)
      : null;
  const avgComms =
    reviewsList.length > 0
      ? (
          reviewsList.reduce((sum, r) => sum + r.communicationRating, 0) /
          reviewsList.length
        ).toFixed(1)
      : null;
  const avgComfort =
    reviewsList.length > 0
      ? (
          reviewsList.reduce((sum, r) => sum + r.experienceRating, 0) /
          reviewsList.length
        ).toFixed(1)
      : null;

  const handleRequestSeat = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }
    if (!isStudentCardVerified) {
      setError('Verify your FAST Student ID Card in Profile before hopping on shared rides.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          rideId: ride.id,
          seatsRequested,
          pickupPoint: effectivePickup,
          passengerNote,
        }),
      });
      await refreshAll();
      setSuccessMsg(
        'Seat request sent. The ride provider will review and confirm your booking.'
      );
      onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send request.');
    } finally {
      setSubmitting(false);
    }
  };

  const maxRows = Math.min(6, Math.max(ride.totalSeatsOffered, 3));
  const splitRows = Array.from({ length: maxRows }, (_, idx) => {
    const pax = idx + 1;
    const divisor = ride.includeDriverInSplit ? pax + 1 : pax;
    const perPerson =
      ride.costMethod === 'fixed_per_seat'
        ? Math.round(ride.estimatedTotalCost / Math.max(1, ride.totalSeatsOffered))
        : Math.round(ride.estimatedTotalCost / divisor);
    return { pax, perPerson };
  });

  return (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4 cursor-pointer"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 shadow-xl cursor-default"
        >
          <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-lg font-bold text-slate-900 font-display">
                <span>{ride.originCity}</span>
                <ArrowRight className="h-4 w-4 text-teal-700" />
                <span>{ride.destinationCity}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {ride.travelDate} · Departure {ride.departureTime}
                {ride.returnTime ? ` · Return ${ride.returnTime}` : ''} ·{' '}
                {ride.journeyType.replace('_', ' ')}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowReport(true)}
                aria-label="Report ride"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100"
              >
                <Flag className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close ride details"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Provider & Vehicle / Carry Separation */}
          <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-3">
              <Avatar
                name={ride.provider?.fullName}
                avatarUrl={ride.provider?.avatarUrl}
                size="md"
              />
              <div>
                <div className="text-xs font-medium text-slate-500">Ride Provider</div>
                <div className="mt-0.5 flex items-center gap-1.5 font-medium text-slate-900">
                  <span>{ride.provider?.fullName}</span>
                  {ride.provider?.verificationStatus === 'verified' && (
                    <ShieldCheck className="h-4 w-4 text-teal-700" />
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                  <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                  <span className="font-mono tabular-nums">
                    {ride.provider?.ratingAvg || '5.00'}
                  </span>
                  <span>({ride.provider?.ratingCount || 0} reviews)</span>
                  {ride.provider?.department ? ` · ${ride.provider.department}` : ''}
                </div>
                {(ride.provider?.cnicVerified || ride.provider?.studentCardVerified) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ride.provider?.cnicVerified && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-md">
                        <ShieldCheck className="h-3 w-3" />
                        CNIC Verified
                      </span>
                    )}
                    {ride.provider?.studentCardVerified && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">
                        <BadgeCheck className="h-3 w-3 text-teal-700" />
                        Student ID Verified
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">
                {ride.transportService ? 'Coordinated Transport Service' : 'Registered Vehicle'}
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-medium text-slate-900">
                {ride.transportService ? (
                  <Bus className="h-4 w-4 text-teal-700 shrink-0" />
                ) : (
                  <Car className="h-4 w-4 text-teal-700 shrink-0" />
                )}
                <span>
                  {ride.transportService
                    ? ride.transportService.serviceName
                    : ride.vehicle?.makeModel}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Actual driver:{' '}
                {ride.transportService
                  ? `${ride.transportService.driverName} (${ride.transportService.vehicleModel})`
                  : ride.vehicle?.isSelfDriven
                  ? `${ride.vehicle.driverName} (Student Owner)`
                  : `${ride.vehicle?.driverName} (Designated Driver)`}
              </div>
            </div>
          </div>

          {/* Pickup Points */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-teal-700" />
              <span>Pickup &amp; Drop-off Corridor</span>
            </div>
            <p className="mt-1 text-sm text-slate-800">{ride.pickupPoints}</p>
            {ride.notes && (
              <p className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-xl p-3 border border-slate-100">
                {ride.notes}
              </p>
            )}
          </div>

          {/* Daily Cost-Sharing & Challan Breakdown */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Calculator className="h-4 w-4 text-teal-700" />
                <span>Damage Split (Cash on Ride)</span>
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                Trip Total: PKR {ride.estimatedTotalCost}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
              <div>
                <div className="text-[11px] text-slate-500">Current Est.</div>
                <div className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                  PKR {splitPreview.currentPerPerson}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">With Your Seat</div>
                <div className="font-mono tabular-nums text-sm font-semibold text-teal-700">
                  PKR {splitPreview.projectedWithNewSeat}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Full Car</div>
                <div className="font-mono tabular-nums text-sm font-semibold text-slate-700">
                  PKR {splitPreview.fullCapacityPerPerson}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {splitRows.map((row) => (
                <span key={row.pax} className="font-mono tabular-nums">
                  {row.pax} pax: PKR {row.perPerson}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {ride.includeDriverInSplit
                ? 'Fuel split includes driver. Cash sorted before rolling out.'
                : 'Fuel splits evenly among passengers. Pay in cash on the ride.'}
            </p>

            {/* Traffic Challan Rule & Logged Challans */}
            <div className="mt-3 rounded-xl bg-amber-50/80 border border-amber-200 p-3 text-xs text-amber-950 space-y-1.5">
              <div className="font-semibold">
                Traffic Challan Squad Rule:{' '}
                {ride.challanSplitEnabled !== false
                  ? 'Divided equally among everyone in that car'
                  : 'Handled separately by driver'}
              </div>
              {ride.challans && ride.challans.length > 0 ? (
                <div className="space-y-1 pt-1">
                  {ride.challans.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums"
                    >
                      <span>
                        {c.title}
                        {c.locationNote ? ` (${c.locationNote})` : ''} · {c.status.toUpperCase()}
                      </span>
                      <span className="font-semibold">
                        PKR {c.amount} ÷ {c.headcount} = PKR {c.perPersonShare}/head
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-amber-900">
                  If the car gets flashed for an e-challan or stopped by a warden, everyone on board splits it per head cleanly.
                </p>
              )}
            </div>
          </div>

          {/* Driver Reviews & Feedback */}
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <MessageSquareText className="h-4 w-4 text-teal-700" />
                <span>Driver Ratings &amp; Reviews ({reviewsList.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <StarRatingDisplay
                  rating={ride.provider?.ratingAvg || '5.00'}
                  count={ride.provider?.ratingCount || 0}
                  size="xs"
                />
                {eligibleBookingToReview && (
                  <button
                    type="button"
                    onClick={() => setShowReviewModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-medium hover:bg-slate-800 cursor-pointer"
                  >
                    Rate Driver
                  </button>
                )}
              </div>
            </div>

            {reviewsList.length > 0 && avgPunctuality && (
              <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
                <span>Punctuality: {avgPunctuality}/5</span>
                <span>Comms: {avgComms}/5</span>
                <span>Comfort: {avgComfort}/5</span>
              </div>
            )}

            {reviewsList.length === 0 ? (
              <p className="text-xs text-slate-500">
                Zero reviews dropped yet. Complete a ride and leave a star rating &amp; comment from My Trips.
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {reviewsList.map((rv) => (
                  <div
                    key={rv.id}
                    className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                        <Avatar
                          name={rv.reviewerName}
                          avatarUrl={rv.reviewerAvatarUrl}
                          size="sm"
                        />
                        <span>{rv.reviewerName}</span>
                      </div>
                      <StarRatingDisplay rating={rv.overallRating} size="xs" />
                    </div>
                    {rv.comment && <p className="text-slate-700">{rv.comment}</p>}
                    <div className="text-[10px] text-slate-400 font-mono">
                      Punctuality {rv.punctualityRating}/5 · Communication {rv.communicationRating}/5 · Experience {rv.experienceRating}/5
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Booking Form */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            {successMsg ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-teal-50 border border-teal-200 p-4 text-sm text-teal-900">
                  {successMsg}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-medium cursor-pointer"
                >
                  Close
                </button>
              </div>
            ) : isOwnRide ? (
              <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
                You are the provider for this ride. Manage incoming passenger requests from My Rides.
              </p>
            ) : ride.availableSeats <= 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 rounded-xl p-3">
                No available seats remain for this occurrence.
              </p>
            ) : (
              <form onSubmit={handleRequestSeat} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Seats Needed
                    </label>
                    <select
                      value={seatsRequested}
                      onChange={(e) => setSeatsRequested(Number(e.target.value))}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-mono tabular-nums"
                    >
                      {Array.from(
                        { length: Math.min(4, ride.availableSeats) },
                        (_, i) => i + 1
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n} seat{n > 1 ? 's' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Pickup Stop
                    </label>
                    {stops.length > 0 ? (
                      <select
                        value={effectivePickup}
                        onChange={(e) => setPickupPoint(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      >
                        {stops.map((stop) => (
                          <option key={stop} value={stop}>
                            {stop}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={effectivePickup}
                        onChange={(e) => setPickupPoint(e.target.value)}
                        placeholder="Enter your pickup point"
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Note for Ride Provider (optional)
                  </label>
                  <input
                    type="text"
                    value={passengerNote}
                    onChange={(e) => setPassengerNote(e.target.value)}
                    placeholder="e.g., Waiting near Satellite Town main gate"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  />
                </div>

                {firebaseUser && !isStudentCardVerified && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-center justify-between gap-3">
                    <span>
                      {profile?.studentCardStatus === 'pending'
                        ? 'Your FAST Student ID Card is under review. Once cleared, you can hop on shared rides.'
                        : profile?.studentCardStatus === 'rejected'
                        ? 'Your Student ID Card was rejected — re-upload a clear photo in Profile to lock a seat.'
                        : 'Student Card verification required to hop on shared rides. Upload your FAST ID Card in Profile.'}
                    </span>
                    {onOpenProfile && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenProfile();
                        }}
                        className="font-semibold underline whitespace-nowrap cursor-pointer"
                      >
                        Verify Card Now
                      </button>
                    )}
                  </div>
                )}

                {error && <p className="text-xs text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {!firebaseUser
                    ? 'Sign in with Google to Lock Seat'
                    : submitting
                    ? 'Sending Request...'
                    : `Lock In ${seatsRequested} Seat${seatsRequested > 1 ? 's' : ''} (Est. PKR ${splitPreview.projectedWithNewSeat * seatsRequested})`}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        rideId={ride.id}
        reportedUserId={ride.providerUserId}
        subjectLabel={`${ride.originCity} → ${ride.destinationCity} (${ride.travelDate})`}
      />

      {showReviewModal && eligibleBookingToReview && (
        <ReviewModal
          booking={eligibleBookingToReview}
          onClose={() => setShowReviewModal(false)}
          onSubmitted={() =>
            setSuccessMsg('Star rating & feedback posted! Driver score updated.')
          }
        />
      )}
    </>
  );
};
