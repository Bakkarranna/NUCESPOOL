import React from 'react';
import { ArrowRight, Bus, Car, Bike, ShieldCheck, Star } from 'lucide-react';
import type { RideItem } from '../types';
import type { MatchBreakdown } from '../lib/matching';
import { Avatar } from './Avatar';

interface RideCardProps {
  ride: RideItem;
  match?: MatchBreakdown | null;
  onSelect: (ride: RideItem) => void;
}

export const RideCard: React.FC<RideCardProps> = ({ ride, match, onSelect }) => {
  const isCarry = Boolean(ride.transportService);
  const isMoto = ride.vehicle?.category === 'motorcycle';
  const vehicleLabel = ride.transportService
    ? `${ride.transportService.serviceName} (${ride.transportService.vehicleModel})`
    : ride.vehicle
    ? `${ride.vehicle.makeModel} · ${ride.vehicle.color}`
    : 'Student Vehicle';

  const driverLabel = ride.transportService
    ? `Driver: ${ride.transportService.driverName}`
    : ride.vehicle && !ride.vehicle.isSelfDriven
    ? `Driver: ${ride.vehicle.driverName}`
    : 'Self-driven';

  return (
    <article className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-teal-700/40 transition-colors flex flex-col justify-between gap-4">
      <div className="space-y-3">
        {/* Top Row: Corridor + Time & Cost */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900 font-display">
              <span className="truncate">{ride.originCity}</span>
              <ArrowRight className="h-4 w-4 text-teal-700 shrink-0" />
              <span className="truncate">{ride.destinationCity}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 truncate">
              {ride.originArea} to {ride.destinationArea}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono tabular-nums text-lg font-semibold text-teal-700">
              PKR {ride.costSplit.currentPerPerson}
            </div>
            <div className="text-[11px] text-slate-500">
              per head
              {ride.challanPerPersonTotal && ride.challanPerPersonTotal > 0
                ? ` (+PKR ${ride.challanPerPersonTotal} challan)`
                : ''}
            </div>
          </div>
        </div>

        {/* Clean Unboxed Metadata Line */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {ride.travelDate}
          </span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="font-mono tabular-nums font-medium text-slate-900">
            Departs {ride.departureTime}
          </span>
          {ride.returnTime && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono tabular-nums">Return {ride.returnTime}</span>
            </>
          )}
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="font-mono tabular-nums">
            {ride.availableSeats}/{ride.totalSeatsOffered} seats left
          </span>
          {ride.challanSplitEnabled !== false && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-amber-700 font-medium">Challan shared</span>
            </>
          )}
        </div>

        {/* Pickup Stops */}
        <div className="text-xs text-slate-600 leading-relaxed">
          <span className="font-medium text-slate-800">Stops: </span>
          {ride.pickupPoints}
        </div>

        {/* Vehicle / Carry Info */}
        <div className="flex items-center gap-2.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
          {isCarry ? (
            <Bus className="h-4 w-4 text-teal-700 shrink-0" />
          ) : isMoto ? (
            <Bike className="h-4 w-4 text-teal-700 shrink-0" />
          ) : (
            <Car className="h-4 w-4 text-teal-700 shrink-0" />
          )}
          <span className="truncate font-medium text-slate-800">{vehicleLabel}</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="truncate text-slate-500">{driverLabel}</span>
        </div>
      </div>

      {/* Footer: Provider + Compatibility Score + Action */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            name={ride.provider?.fullName}
            avatarUrl={ride.provider?.avatarUrl}
            size="md"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 truncate">
              <span className="truncate">{ride.provider?.fullName || 'Student'}</span>
              {ride.provider?.verificationStatus === 'verified' && (
                <ShieldCheck
                  className="h-3.5 w-3.5 text-teal-700 shrink-0"
                  aria-label="Verified FAST-NUCES Student"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
              <span className="font-mono tabular-nums">
                {ride.provider?.ratingAvg || '5.00'} ({ride.provider?.ratingCount || 0})
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {ride.provider?.isCoordinator ? 'Transport Coordinator' : 'Student Driver'}
              </span>
              {match && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums font-medium text-teal-700">
                    {match.totalScore}% vibe match
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelect(ride)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Scope Ride
        </button>
      </div>
    </article>
  );
};
