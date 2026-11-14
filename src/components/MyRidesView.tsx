import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Check,
  Compass,
  MapPin,
  MessageSquare,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { BookingItem, RideChallanItem } from '../types';
import { Avatar } from './Avatar';
import { LiveLocationMap } from './LiveLocationMap';
import { ReviewModal } from './ReviewModal';
import { StarRatingDisplay } from './StarRating';

const CHALLAN_PRESETS = [
  'E-Challan Speeding',
  'Traffic Warden Fine',
  'Signal Jump',
  'No Seatbelt',
  'Wrong Lane / U-Turn',
];

interface MyRidesViewProps {
  onOpenChat: (rideId: number, otherUserId: number) => void;
  onFindNewRide: () => void;
}

export const MyRidesView: React.FC<MyRidesViewProps> = ({
  onOpenChat,
  onFindNewRide,
}) => {
  const { firebaseUser, profile, workspace, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();
  const [tab, setTab] = useState<'passenger' | 'provider'>('passenger');
  const [reviewTarget, setReviewTarget] = useState<BookingItem | null>(null);
  const [challanTarget, setChallanTarget] = useState<{
    rideId: number;
    rideLabel: string;
    estimatedPeople: number;
  } | null>(null);
  const [challanTitle, setChallanTitle] = useState(CHALLAN_PRESETS[0]);
  const [challanAmount, setChallanAmount] = useState<number>(1000);
  const [challanLocation, setChallanLocation] = useState('');
  const [challanIncludeDriver, setChallanIncludeDriver] = useState(true);

  const [liveMapTarget, setLiveMapTarget] = useState<{
    rideId: number;
    rideLabel: string;
    userRole: 'driver' | 'passenger';
  } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!challanTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChallanTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [challanTarget]);

  if (!firebaseUser) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
        <h2 className="text-xl font-bold text-slate-900 font-display">My Rides &amp; Bookings</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to manage your upcoming carpools, pending seat requests, live GPS sharing, and driver reviews.
        </p>
        <button
          type="button"
          onClick={signInWithGoogle}
          className="mt-5 min-h-[44px] px-6 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const myBookings = workspace?.myBookings ?? [];
  const incomingBookings = workspace?.incomingBookings ?? [];
  const providerRides = workspace?.providerRides ?? [];
  const receivedReviews = workspace?.receivedReviews ?? [];

  const handleBookingAction = async (
    bookingId: number,
    action: 'accept' | 'reject' | 'cancel' | 'complete' | 'no_show'
  ) => {
    setBusyId(bookingId);
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      await refreshAll();
      setFeedback(
        action === 'cancel'
          ? `Booking #${bookingId} cancelled. You can now book a new ride anytime.`
          : `Booking #${bookingId} updated (${action}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update booking.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRideStatus = async (rideId: number, status: 'completed' | 'cancelled') => {
    setBusyId(rideId);
    setError(null);
    setFeedback(null);
    try {
      await apiFetch(`/api/rides/${rideId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await refreshAll();
      setFeedback(`Ride #${rideId} marked ${status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ride.');
    } finally {
      setBusyId(null);
    }
  };

  const handleChallanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challanTarget) return;
    setBusyId(challanTarget.rideId);
    setError(null);
    setFeedback(null);
    try {
      const res = await apiFetch<{ challan: RideChallanItem }>(
        `/api/rides/${challanTarget.rideId}/challans`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: challanTitle,
            amount: challanAmount,
            locationNote: challanLocation,
            includeDriver: challanIncludeDriver,
          }),
        }
      );
      await refreshAll();
      setChallanTarget(null);
      setChallanLocation('');
      setFeedback(
        `Challan logged (PKR ${res.challan.amount}) ÷ ${res.challan.headcount} in the car = PKR ${res.challan.perPersonShare} per head. Everyone got pinged!`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log traffic challan.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleChallanSettle = async (challanId: number) => {
    setBusyId(challanId);
    setError(null);
    try {
      await apiFetch(`/api/challans/${challanId}/settle`, { method: 'PATCH' });
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update challan.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteChallan = async (challanId: number) => {
    setBusyId(challanId);
    setError(null);
    try {
      await apiFetch(`/api/challans/${challanId}`, { method: 'DELETE' });
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove challan.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            My Squad &amp; Trips
          </h2>
          <p className="text-sm text-slate-500">
            Track seats, drop live GPS pins, split traffic challans per head, and rate your driver&apos;s vibe.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setTab('passenger')}
            className={`min-h-[40px] px-4 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              tab === 'passenger'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Riding Shotgun ({myBookings.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('provider')}
            className={`min-h-[40px] px-4 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              tab === 'provider'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Wheels / Hosted ({providerRides.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-sm text-teal-900 flex flex-wrap items-center justify-between gap-2">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={onFindNewRide}
            className="text-xs font-semibold text-teal-800 underline cursor-pointer"
          >
            Browse New Rides →
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Active Google Maps Live Location Drawer */}
      {liveMapTarget && (
        <LiveLocationMap
          rideId={liveMapTarget.rideId}
          rideLabel={liveMapTarget.rideLabel}
          userRole={liveMapTarget.userRole}
          onClose={() => setLiveMapTarget(null)}
        />
      )}

      {tab === 'passenger' && (
        <div className="space-y-4">
          {myBookings.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <p className="text-sm text-slate-500">
                No ride requests yet. Browse the Chiniot ↔ Faisalabad ride board to request a seat.
              </p>
              <button
                type="button"
                onClick={onFindNewRide}
                className="min-h-[44px] px-5 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Compass className="h-4 w-4" />
                <span>Find &amp; Book a Ride</span>
              </button>
            </div>
          ) : (
            myBookings.map((b) => {
              const rideLabel = b.ride
                ? `${b.ride.originCity} → ${b.ride.destinationCity} (${b.ride.travelDate})`
                : `Ride #${b.rideId}`;
              const rideChallans = b.ride?.challans ?? [];
              const activeChallanPerSeat = b.ride?.challanPerPersonTotal ?? 0;
              const myChallanTotal = activeChallanPerSeat * b.seatsRequested;
              const totalDamage = b.agreedContribution + myChallanTotal;
              const estCarHeadcount = b.ride
                ? Math.max(2, b.ride.totalSeatsOffered - b.ride.availableSeats + 1)
                : 2;

              return (
                <div
                  key={b.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={b.provider?.fullName}
                        avatarUrl={b.provider?.avatarUrl}
                        size="md"
                      />
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-900">
                          {b.ride
                            ? `${b.ride.originCity} → ${b.ride.destinationCity}`
                            : `Ride #${b.rideId}`}
                        </div>
                        <div className="text-xs text-slate-600 font-mono tabular-nums">
                          {b.ride?.travelDate} · Departs {b.ride?.departureTime} · {b.seatsRequested} seat(s) · Stop: {b.pickupPoint}
                        </div>
                        <div className="text-xs text-slate-500">
                          Driver / Ustaad: {b.provider?.fullName || 'Student'}
                          {b.provider?.phone ? ` (${b.provider.phone})` : ''} · Status:{' '}
                          <span className="font-semibold uppercase text-slate-900">{b.status}</span> ·{' '}
                          {myChallanTotal > 0 ? (
                            <>
                              Fuel <span className="font-mono">PKR {b.agreedContribution}</span> + Challan{' '}
                              <span className="font-mono text-amber-700">PKR {myChallanTotal}</span> ={' '}
                              <span className="font-mono tabular-nums font-semibold text-teal-700">
                                Total PKR {totalDamage}
                              </span>
                            </>
                          ) : (
                            <>
                              Cash damage:{' '}
                              <span className="font-mono tabular-nums font-semibold text-teal-700">
                                PKR {b.agreedContribution}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {b.ride && ['pending', 'accepted'].includes(b.status) && (
                        <button
                          type="button"
                          onClick={() =>
                            setLiveMapTarget({
                              rideId: b.ride!.id,
                              rideLabel,
                              userRole: 'passenger',
                            })
                          }
                          className="min-h-[44px] px-3.5 rounded-xl border border-teal-200 bg-teal-50 text-xs font-medium text-teal-800 hover:bg-teal-100 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          <span>Drop Live Pin</span>
                        </button>
                      )}

                      {b.ride && ['accepted', 'completed'].includes(b.status) && (
                        <button
                          type="button"
                          onClick={() =>
                            setChallanTarget({
                              rideId: b.ride!.id,
                              rideLabel,
                              estimatedPeople: estCarHeadcount,
                            })
                          }
                          className="min-h-[44px] px-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs font-medium text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <AlertOctagon className="h-3.5 w-3.5" />
                          <span>Split Challan</span>
                        </button>
                      )}

                      {b.ride && b.provider && (
                        <button
                          type="button"
                          onClick={() => onOpenChat(b.ride!.id, b.provider!.id)}
                          className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>Chat</span>
                        </button>
                      )}

                      {['pending', 'accepted'].includes(b.status) && (
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => handleBookingAction(b.id, 'cancel')}
                          className="min-h-[44px] px-3.5 rounded-xl border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          Bail / Cancel
                        </button>
                      )}

                      {['cancelled', 'rejected'].includes(b.status) && (
                        <button
                          type="button"
                          onClick={onFindNewRide}
                          className="min-h-[44px] px-4 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Compass className="h-3.5 w-3.5" />
                          <span>Book New Ride</span>
                        </button>
                      )}

                      {['accepted', 'completed'].includes(b.status) && !b.hasReviewed && (
                        <button
                          type="button"
                          onClick={() => setReviewTarget(b)}
                          className={`min-h-[44px] px-4 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                            b.status === 'completed'
                              ? 'bg-teal-700 text-white hover:bg-teal-800'
                              : 'bg-slate-900 text-white hover:bg-slate-800'
                          }`}
                        >
                          <Star className="h-3.5 w-3.5 text-amber-300 fill-amber-300" />
                          <span>
                            {b.status === 'completed'
                              ? 'Leave Star Rating & Feedback'
                              : 'Rate Driver Vibe'}
                          </span>
                        </button>
                      )}

                      {b.hasReviewed && (
                        <span className="text-xs font-medium text-teal-700 px-2">
                          ✓ Rating Posted
                        </span>
                      )}
                    </div>
                  </div>

                  {b.hasReviewed && b.myReview && (
                    <div className="pt-3 border-t border-slate-100 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">
                          Your Driver Review
                        </span>
                        <StarRatingDisplay
                          rating={b.myReview.overallRating}
                          size="xs"
                        />
                      </div>
                      {b.myReview.comment && (
                        <p className="text-slate-700">&ldquo;{b.myReview.comment}&rdquo;</p>
                      )}
                      <div className="text-[11px] font-mono text-slate-400">
                        Punctuality {b.myReview.punctualityRating}/5 · Comms{' '}
                        {b.myReview.communicationRating}/5 · Comfort{' '}
                        {b.myReview.experienceRating}/5
                      </div>
                    </div>
                  )}

                  {rideChallans.length > 0 && (
                    <div className="pt-3 border-t border-slate-100 space-y-1.5">
                      <div className="text-[11px] font-semibold text-amber-900">
                        Traffic Challans Split on This Car ({rideChallans.length})
                      </div>
                      {rideChallans.map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">{c.title}</span>
                            {c.locationNote && (
                              <span className="text-slate-600"> · {c.locationNote}</span>
                            )}
                            <span className="text-slate-500"> · logged by {c.reportedByName}</span>
                          </div>
                          <div className="flex items-center gap-2 font-mono tabular-nums text-[11px]">
                            <span>
                              PKR {c.amount} ÷ {c.headcount} ={' '}
                              <strong className="text-amber-900">PKR {c.perPersonShare}/head</strong>
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full font-sans font-semibold ${
                                c.status === 'settled'
                                  ? 'bg-teal-100 text-teal-800'
                                  : 'bg-amber-200/70 text-amber-950'
                              }`}
                            >
                              {c.status === 'settled' ? 'Settled' : 'Due'}
                            </span>
                            {c.reportedByUserId === profile?.id && (
                              <button
                                type="button"
                                onClick={() => handleToggleChallanSettle(c.id)}
                                className="underline text-teal-800 font-sans cursor-pointer"
                              >
                                {c.status === 'settled' ? 'Reopen' : 'Mark Settled'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'provider' && (
        <div className="space-y-6">
          {/* Incoming Requests Queue */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Incoming Passenger Requests ({incomingBookings.length})
            </h3>
            {incomingBookings.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500">
                No passenger booking requests on your rides yet.
              </div>
            ) : (
              incomingBookings.map((b) => (
                <div
                  key={b.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={b.passenger?.fullName}
                      avatarUrl={b.passenger?.avatarUrl}
                      size="md"
                    />
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-900">
                        {b.passenger?.fullName || 'Student'} · {b.seatsRequested} seat(s) at {b.pickupPoint}
                      </div>
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        {b.ride?.originCity} → {b.ride?.destinationCity} · {b.ride?.travelDate} ({b.ride?.departureTime})
                      </div>
                      <div className="text-xs text-slate-500">
                        Status: <span className="font-semibold uppercase text-slate-900">{b.status}</span> · Contribution: PKR {b.agreedContribution}
                        {b.passengerNote ? ` · Note: "${b.passengerNote}"` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {b.ride && b.passenger && (
                      <button
                        type="button"
                        onClick={() => onOpenChat(b.ride!.id, b.passenger!.id)}
                        className="min-h-[44px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Message
                      </button>
                    )}

                    {b.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => handleBookingAction(b.id, 'accept')}
                          className="min-h-[44px] px-4 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Accept</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => handleBookingAction(b.id, 'reject')}
                          className="min-h-[44px] px-3.5 rounded-xl border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}

                    {b.status === 'accepted' && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => handleBookingAction(b.id, 'complete')}
                          className="min-h-[44px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 cursor-pointer"
                        >
                          Mark Done
                        </button>
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => handleBookingAction(b.id, 'no_show')}
                          className="min-h-[44px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          Ghosted / No-Show
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Provider Published Rides */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Your Hosted Rides &amp; Challans
            </h3>
            {providerRides.map((r) => {
              const rideChallans = r.challans ?? [];
              const estHeadcount = Math.max(
                1,
                r.totalSeatsOffered - r.availableSeats + 1
              );
              return (
                <div
                  key={r.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-900">
                        {r.originCity} → {r.destinationCity} · {r.travelDate}
                      </div>
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        Departs {r.departureTime} · {r.availableSeats}/{r.totalSeatsOffered} seats left · Status: {r.status}
                        {r.challanPerPersonTotal && r.challanPerPersonTotal > 0
                          ? ` · Challan: PKR ${r.challanPerPersonTotal}/head`
                          : ''}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {r.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() =>
                            setChallanTarget({
                              rideId: r.id,
                              rideLabel: `${r.originCity} → ${r.destinationCity} (${r.travelDate})`,
                              estimatedPeople: estHeadcount,
                            })
                          }
                          className="min-h-[44px] px-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs font-medium text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <AlertOctagon className="h-3.5 w-3.5" />
                          <span>Log Traffic Challan</span>
                        </button>
                      )}

                      {r.status === 'scheduled' && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setLiveMapTarget({
                                rideId: r.id,
                                rideLabel: `${r.originCity} → ${r.destinationCity} (${r.travelDate})`,
                                userRole: 'driver',
                              })
                            }
                            className="min-h-[44px] px-3.5 rounded-xl border border-teal-200 bg-teal-50 text-xs font-medium text-teal-800 hover:bg-teal-100 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            <span>Squad Live Radar</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleRideStatus(r.id, 'completed')}
                            className="min-h-[44px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 cursor-pointer"
                          >
                            Trip Done
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleRideStatus(r.id, 'cancelled')}
                            className="min-h-[44px] px-3.5 rounded-xl border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            Cancel Ride
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {rideChallans.length > 0 && (
                    <div className="pt-3 border-t border-slate-100 space-y-1.5">
                      <div className="text-[11px] font-semibold text-amber-900">
                        Traffic Challans on This Ride ({rideChallans.length})
                      </div>
                      {rideChallans.map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">{c.title}</span>
                            {c.locationNote && (
                              <span className="text-slate-600"> · {c.locationNote}</span>
                            )}
                            <span className="text-slate-500"> · logged by {c.reportedByName}</span>
                          </div>
                          <div className="flex items-center gap-2 font-mono tabular-nums text-[11px]">
                            <span>
                              PKR {c.amount} ÷ {c.headcount} ={' '}
                              <strong className="text-amber-900">PKR {c.perPersonShare}/head</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleChallanSettle(c.id)}
                              className={`px-2 py-0.5 rounded-full font-sans font-semibold cursor-pointer ${
                                c.status === 'settled'
                                  ? 'bg-teal-100 text-teal-800'
                                  : 'bg-amber-200 text-amber-950'
                              }`}
                            >
                              {c.status === 'settled' ? 'Settled ✓' : 'Mark Settled'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteChallan(c.id)}
                              aria-label="Delete challan"
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Driver Received Star Ratings & Feedback */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Rider Star Ratings &amp; Feedback ({receivedReviews.length})
              </h3>
              <StarRatingDisplay
                rating={profile?.ratingAvg || '5.00'}
                count={profile?.ratingCount || 0}
                size="sm"
              />
            </div>

            {receivedReviews.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500">
                No rider reviews yet. Once students complete rides with you, their star ratings and comments will appear here.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {receivedReviews.map((rv) => (
                  <div
                    key={rv.id}
                    className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          name={rv.reviewerName}
                          avatarUrl={rv.reviewerAvatarUrl}
                          size="sm"
                        />
                        <div>
                          <div className="font-semibold text-slate-900">
                            {rv.reviewerName}
                          </div>
                          {rv.rideLabel && (
                            <div className="text-[11px] text-slate-500">
                              {rv.rideLabel}
                            </div>
                          )}
                        </div>
                      </div>
                      <StarRatingDisplay rating={rv.overallRating} size="xs" />
                    </div>
                    {rv.comment && (
                      <p className="text-slate-700 leading-relaxed">
                        &ldquo;{rv.comment}&rdquo;
                      </p>
                    )}
                    <div className="text-[11px] font-mono text-slate-400">
                      Punctuality {rv.punctualityRating}/5 · Comms{' '}
                      {rv.communicationRating}/5 · Comfort {rv.experienceRating}/5
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Traffic Challan Split Modal */}
      {challanTarget && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setChallanTarget(null);
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4 cursor-pointer"
        >
          <form
            onSubmit={handleChallanSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4 cursor-default"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Split Traffic Challan Across Car
                </h3>
                <p className="text-xs text-slate-500">{challanTarget.rideLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setChallanTarget(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">
                Challan Type
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CHALLAN_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setChallanTitle(preset)}
                    className={`px-2.5 py-1 rounded-lg text-xs border cursor-pointer ${
                      challanTitle === preset
                        ? 'bg-amber-100 border-amber-400 text-amber-950 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                required
                value={challanTitle}
                onChange={(e) => setChallanTitle(e.target.value)}
                placeholder="e.g., E-Challan at Canal Road"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Fine Amount (PKR)
                </label>
                <input
                  type="number"
                  min={50}
                  max={100000}
                  step={50}
                  required
                  value={challanAmount}
                  onChange={(e) => setChallanAmount(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Spot / Checkpoint
                </label>
                <input
                  type="text"
                  value={challanLocation}
                  onChange={(e) => setChallanLocation(e.target.value)}
                  placeholder="e.g., Jhumra / M-3"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={challanIncludeDriver}
                onChange={(e) => setChallanIncludeDriver(e.target.checked)}
                className="h-4 w-4 accent-teal-700 rounded"
              />
              <span>Divide equally with driver included (everyone on board)</span>
            </label>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 font-mono tabular-nums">
              Est. split: PKR {challanAmount || 0} ÷{' '}
              {Math.max(
                1,
                challanIncludeDriver
                  ? challanTarget.estimatedPeople
                  : Math.max(1, challanTarget.estimatedPeople - 1)
              )}{' '}
              in car ={' '}
              <strong>
                PKR{' '}
                {Math.round(
                  (challanAmount || 0) /
                    Math.max(
                      1,
                      challanIncludeDriver
                        ? challanTarget.estimatedPeople
                        : Math.max(1, challanTarget.estimatedPeople - 1)
                    )
                )}
                /head
              </strong>
            </div>

            <button
              type="submit"
              disabled={busyId === challanTarget.rideId}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer"
            >
              {busyId === challanTarget.rideId
                ? 'Splitting...'
                : 'Log & Split Challan Across Squad'}
            </button>
          </form>
        </div>
      )}

      {/* Interactive Star Rating & Feedback Modal */}
      <ReviewModal
        booking={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onSubmitted={() =>
          setFeedback('Star rating & feedback posted! Driver score updated.')
        }
      />
    </div>
  );
};
