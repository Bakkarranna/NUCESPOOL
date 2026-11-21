import React from 'react';
import { ArrowRight, MapPin, ShieldCheck, Star, Users } from 'lucide-react';
import type { RideRequestItem } from '../types';
import { Avatar } from './Avatar';

interface RideRequestCardProps {
  request: RideRequestItem;
  isOwnRequest: boolean;
  onAccept: (request: RideRequestItem) => void;
  onCancel?: (requestId: number) => void;
  busy?: boolean;
}

export const RideRequestCard: React.FC<RideRequestCardProps> = ({
  request,
  isOwnRequest,
  onAccept,
  onCancel,
  busy,
}) => {
  return (
    <article className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-teal-700/40 transition-colors flex flex-col justify-between gap-4">
      <div className="space-y-3">
        {/* Top Row: Corridor + Max Budget */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900 font-display">
              <span className="truncate">{request.originCity}</span>
              <ArrowRight className="h-4 w-4 text-teal-700 shrink-0" />
              <span className="truncate">{request.destinationCity}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 truncate">
              {request.originArea} to {request.destinationArea}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono tabular-nums text-lg font-semibold text-teal-700">
              PKR {request.maxBudgetPerSeat}
            </div>
            <div className="text-[11px] text-slate-500">max / seat</div>
          </div>
        </div>

        {/* Clean Metadata Line */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {request.travelDate}
          </span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="font-mono tabular-nums font-medium text-slate-900">
            Needs {request.preferredTime}
          </span>
          {request.returnTime && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono tabular-nums">Return {request.returnTime}</span>
            </>
          )}
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-900 font-medium">
            <Users className="h-3 w-3 text-teal-700" />
            {request.seatsNeeded} seat{request.seatsNeeded > 1 ? 's' : ''}
          </span>
        </div>

        {/* Pickup Stop & Notes */}
        <div className="text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-teal-700 shrink-0 mt-0.5" />
          <span>
            <strong className="font-medium text-slate-800">Pickup:</strong>{' '}
            {request.pickupPoint}
          </span>
        </div>

        {request.notes && (
          <p className="text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
            {request.notes}
          </p>
        )}
      </div>

      {/* Footer: Passenger + Action */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            name={request.passenger?.fullName}
            avatarUrl={request.passenger?.avatarUrl}
            size="md"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 truncate">
              <span className="truncate">
                {request.passenger?.fullName || 'FAST Student'}
              </span>
              {request.passenger?.verificationStatus === 'verified' && (
                <ShieldCheck
                  className="h-3.5 w-3.5 text-teal-700 shrink-0"
                  aria-label="Verified FAST-NUCES Student"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
              <span className="font-mono tabular-nums">
                {request.passenger?.ratingAvg || '5.00'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">Needs Ride</span>
            </div>
          </div>
        </div>

        {isOwnRequest ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-medium text-teal-700">Live to Drivers</span>
            {onCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCancel(request.id)}
                className="min-h-[40px] px-3 rounded-xl border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept(request)}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            Pick Up / Offer Ride
          </button>
        )}
      </div>
    </article>
  );
};
