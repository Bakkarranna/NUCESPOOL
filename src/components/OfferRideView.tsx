import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Bus,
  Car,
  CreditCard,
  IdCard,
  Plus,
  Repeat,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { calculateDailyCostSplit } from '../lib/matching';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function compressImageToDataUrl(
  file: File,
  maxSize = 800,
  quality = 0.88
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function formatCnicInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

interface OfferRideViewProps {
  onPublished: () => void;
  onOpenProfile: () => void;
}

export const OfferRideView: React.FC<OfferRideViewProps> = ({
  onPublished,
  onOpenProfile,
}) => {
  const { firebaseUser, profile, workspace, catalog, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();
  const [subTab, setSubTab] = useState<'publish' | 'vehicle' | 'carry'>('publish');

  // Publish Ride State
  const routes = catalog?.routes ?? [];
  const [routeId, setRouteId] = useState<number>(routes[0]?.id ?? 1);

  useEffect(() => {
    if (routes.length > 0 && !routes.some((r) => r.id === routeId)) {
      setRouteId(routes[0].id);
    }
  }, [routes, routeId]);

  const [transportSource, setTransportSource] = useState<string>('');
  const [originArea, setOriginArea] = useState('Satellite Town, Chiniot');
  const [destinationArea, setDestinationArea] = useState('FAST-NUCES Campus, Faisalabad');
  const [pickupPoints, setPickupPoints] = useState(
    'Satellite Town Gate · Chiniot Bridge · Loonaywala Stop'
  );
  const [travelDate, setTravelDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [departureTime, setDepartureTime] = useState('07:30');
  const [returnTime, setReturnTime] = useState('15:30');
  const [journeyType, setJourneyType] = useState<'morning' | 'evening' | 'round_trip'>(
    'round_trip'
  );
  const [isRecurring, setIsRecurring] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
  ]);
  const [offeredSeats, setOfferedSeats] = useState(3);
  const [estimatedTotalCost, setEstimatedTotalCost] = useState(1200);
  const [costMethod, setCostMethod] = useState<'equal_split' | 'fixed_per_seat'>(
    'equal_split'
  );
  const [includeDriverInSplit, setIncludeDriverInSplit] = useState(false);
  const [challanSplitEnabled, setChallanSplitEnabled] = useState(true);
  const [notes, setNotes] = useState('');

  // Personal Vehicle Form
  const [vehCategory, setVehCategory] = useState<'car' | 'motorcycle'>('car');
  const [vehModel, setVehModel] = useState('');
  const [vehReg, setVehReg] = useState('');
  const [vehColor, setVehColor] = useState('');
  const [vehCap, setVehCap] = useState(3);
  const [vehSelfDriven, setVehSelfDriven] = useState(true);
  const [vehDriverName, setVehDriverName] = useState('');
  const [vehDriverPhone, setVehDriverPhone] = useState('');

  // Transport Service / Carry Form
  const [srvName, setSrvName] = useState('');
  const [srvType, setSrvType] = useState<'carry' | 'van' | 'private_driver'>('carry');
  const [srvModel, setSrvModel] = useState('');
  const [srvReg, setSrvReg] = useState('');
  const [srvCap, setSrvCap] = useState(6);
  const [srvDriverName, setSrvDriverName] = useState('');
  const [srvDriverPhone, setSrvDriverPhone] = useState('');
  const [srvAuthNote, setSrvAuthNote] = useState('');

  // Inline Driver CNIC upload for Vehicle & Carry registration
  const [docCnicNumber, setDocCnicNumber] = useState('');
  const [docCnicImageUrl, setDocCnicImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.cnicNumber) {
      setDocCnicNumber((prev) => prev || profile.cnicNumber || '');
    }
    if (profile?.cnicImageUrl) {
      setDocCnicImageUrl((prev) => prev || profile.cnicImageUrl || null);
    }
  }, [profile?.cnicNumber, profile?.cnicImageUrl]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vehiclesList = workspace?.vehicles ?? [];
  const servicesList = workspace?.transportServices ?? [];

  const activeSourceValue = useMemo(() => {
    if (transportSource) return transportSource;
    const verifiedVeh = vehiclesList.find((v) => v.verificationStatus === 'verified');
    if (verifiedVeh) return `vehicle:${verifiedVeh.id}`;
    const verifiedSrv = servicesList.find((s) => s.verificationStatus === 'verified');
    if (verifiedSrv) return `service:${verifiedSrv.id}`;
    if (vehiclesList[0]) return `vehicle:${vehiclesList[0].id}`;
    if (servicesList[0]) return `service:${servicesList[0].id}`;
    return '';
  }, [transportSource, vehiclesList, servicesList]);

  const selectedSourceInfo = useMemo(() => {
    if (!activeSourceValue) return null;
    const [kind, idStr] = activeSourceValue.split(':');
    const id = Number(idStr);
    if (kind === 'vehicle') {
      const v = vehiclesList.find((item) => item.id === id);
      return v ? { kind: 'vehicle' as const, label: v.makeModel, status: v.verificationStatus } : null;
    }
    if (kind === 'service') {
      const s = servicesList.find((item) => item.id === id);
      return s ? { kind: 'service' as const, label: s.serviceName, status: s.verificationStatus } : null;
    }
    return null;
  }, [activeSourceValue, vehiclesList, servicesList]);

  const splitPreview = useMemo(() => {
    return calculateDailyCostSplit({
      estimatedTotalCost,
      totalSeatsOffered: offeredSeats,
      availableSeats: offeredSeats,
      costMethod,
      includeDriverInSplit,
      additionalSeats: 1,
    });
  }, [estimatedTotalCost, offeredSeats, costMethod, includeDriverInSplit]);

  if (!firebaseUser) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
        <h2 className="text-xl font-bold text-slate-900 font-display">
          Offer a Ride or Register a Campus Carry
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with your Google account to register a personal vehicle, coordinate an existing carry arrangement, and publish Chiniot ↔ Faisalabad schedules.
        </p>
        <button
          type="button"
          onClick={signInWithGoogle}
          className="mt-5 min-h-[44px] px-6 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const hasStudentCard = profile?.studentCardStatus === 'verified';
  const hasCnic = profile?.cnicVerificationStatus === 'verified';
  const verifiedVehiclesCount = vehiclesList.filter(
    (v) => v.verificationStatus === 'verified'
  ).length;
  const verifiedServicesCount = servicesList.filter(
    (s) => s.verificationStatus === 'verified'
  ).length;
  const hasVerifiedSource =
    selectedSourceInfo?.status === 'verified' ||
    (profile?.isAdmin && Boolean(activeSourceValue));
  const canPublishRide = Boolean(
    profile?.isAdmin || (hasStudentCard && hasCnic && hasVerifiedSource)
  );

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleCnicPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);
    try {
      const compressed = await compressImageToDataUrl(file, 800, 0.88);
      setDocCnicImageUrl(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read CNIC image.');
    }
  };

  const handlePublishRide = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!canPublishRide) {
      setError(
        'Complete Student ID Card upload, manual Admin CNIC verification, and wait for your vehicle/carry to be verified by Campus Admin before publishing rides.'
      );
      return;
    }
    if (!activeSourceValue) {
      setError('Register a vehicle or transport service first using the tabs above.');
      return;
    }
    if (isRecurring && selectedDays.length === 0) {
      setError('Select at least one weekday for a recurring ride schedule.');
      return;
    }

    const [kind, idStr] = activeSourceValue.split(':');
    setBusy(true);
    try {
      const payload = {
        routeId: routeId || routes[0]?.id || 1,
        vehicleId: kind === 'vehicle' ? Number(idStr) : null,
        transportServiceId: kind === 'service' ? Number(idStr) : null,
        originArea,
        destinationArea,
        pickupPoints,
        travelDate,
        departureTime,
        returnTime: journeyType === 'morning' ? null : returnTime,
        journeyType,
        isRecurring,
        weekdays: selectedDays.join(','),
        offeredSeats,
        estimatedTotalCost,
        costMethod,
        includeDriverInSplit,
        challanSplitEnabled,
        notes,
      };
      const res = await apiFetch<{ rides: unknown[] }>('/api/rides', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refreshAll();
      setMessage(
        isRecurring
          ? `Recurring schedule saved and ${res.rides.length} upcoming ride occurrences published.`
          : 'Ride published to the student discovery board.'
      );
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish ride.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const digits = docCnicNumber.replace(/\D/g, '');
    if (!profile?.isAdmin && digits.length !== 13) {
      setError('Enter all 13 digits of your Pakistani CNIC (XXXXX-XXXXXXX-X).');
      return;
    }
    if (!profile?.isAdmin && !docCnicImageUrl) {
      setError('Upload a clear front photo of your CNIC card to register a vehicle.');
      return;
    }

    setBusy(true);
    try {
      await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          category: vehCategory,
          makeModel: vehModel,
          registrationNumber: vehReg,
          color: vehColor,
          capacity: vehCap,
          isSelfDriven: vehSelfDriven,
          driverName: vehSelfDriven ? profile?.fullName || vehDriverName : vehDriverName,
          driverPhone: vehSelfDriven ? profile?.phone || vehDriverPhone : vehDriverPhone,
          cnicNumber: docCnicNumber || undefined,
          cnicImageUrl: docCnicImageUrl || undefined,
        }),
      });
      await refreshAll();
      setVehModel('');
      setVehReg('');
      setVehColor('');
      setMessage(
        'Personal vehicle & CNIC image saved to database. Awaiting manual Campus Admin verification before you can drop rides.'
      );
      setSubTab('publish');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register vehicle.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterService = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const digits = docCnicNumber.replace(/\D/g, '');
    if (!profile?.isAdmin && digits.length !== 13) {
      setError('Enter all 13 digits of your Pakistani CNIC (XXXXX-XXXXXXX-X).');
      return;
    }
    if (!profile?.isAdmin && !docCnicImageUrl) {
      setError('Upload a clear front photo of your CNIC card to register a carry service.');
      return;
    }

    setBusy(true);
    try {
      await apiFetch('/api/transport-services', {
        method: 'POST',
        body: JSON.stringify({
          serviceName: srvName,
          serviceType: srvType,
          vehicleModel: srvModel,
          registrationNumber: srvReg,
          capacity: srvCap,
          driverName: srvDriverName,
          driverPhone: srvDriverPhone,
          authorizationNote: srvAuthNote,
          cnicNumber: docCnicNumber || undefined,
          cnicImageUrl: docCnicImageUrl || undefined,
        }),
      });
      await refreshAll();
      setSrvName('');
      setSrvModel('');
      setSrvReg('');
      setSrvDriverName('');
      setSrvDriverPhone('');
      setSrvAuthNote('');
      setMessage(
        'Carry / transport service & CNIC image saved to database. Awaiting manual Campus Admin verification before publishing schedules.'
      );
      setSubTab('publish');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register service.');
    } finally {
      setBusy(false);
    }
  };

  const renderCnicUploadSection = (contextLabel: string) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <IdCard className="h-4 w-4 text-teal-700 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-slate-900">
              Coordinator / Driver CNIC Verification ({contextLabel})
            </div>
            <p className="text-[11px] text-slate-500">
              Saved permanently in our database and manually verified by Campus Admin before rides go live.
            </p>
          </div>
        </div>
        {profile?.cnicVerificationStatus === 'verified' ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 shrink-0">
            CNIC Verified
          </span>
        ) : profile?.cnicVerificationStatus === 'pending' ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 shrink-0">
            Admin Review Pending
          </span>
        ) : (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0">
            Required
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            13-Digit CNIC Number
          </label>
          <div className="relative">
            <CreditCard className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              required={!profile?.isAdmin}
              value={docCnicNumber}
              onChange={(e) => setDocCnicNumber(formatCnicInput(e.target.value))}
              placeholder="33100-1234567-1"
              maxLength={15}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-mono tabular-nums"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            CNIC Front Image
          </label>
          <label className="flex items-center justify-center gap-2 min-h-[42px] px-3 rounded-xl border border-dashed border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer">
            <Upload className="h-4 w-4 text-teal-700" />
            <span>
              {docCnicImageUrl ? 'Replace CNIC Photo' : 'Upload CNIC Photo'}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleCnicPick}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {docCnicImageUrl && (
        <div className="rounded-lg overflow-hidden border border-slate-200 bg-white">
          <img
            src={docCnicImageUrl}
            alt="Driver CNIC front preview"
            className="w-full h-36 object-contain"
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Drop a Ride &amp; Flex Your Wheels
          </h2>
          <p className="text-sm text-slate-500">
            Register your car/bike or carry service with CNIC for manual Admin review, then publish rides.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setSubTab('publish')}
            className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'publish'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Publish Ride
          </button>
          <button
            type="button"
            onClick={() => setSubTab('vehicle')}
            className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'vehicle'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Add Vehicle ({vehiclesList.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('carry')}
            className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'carry'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Add Carry Service ({servicesList.length})
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl bg-teal-50 border border-teal-200 p-4 text-sm text-teal-900">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {subTab === 'publish' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handlePublishRide}
            className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
          >
            {/* Driver / Coordinator Verification Readiness Checklist */}
            {!profile?.isAdmin &&
              (!hasStudentCard || !hasCnic || verifiedVehiclesCount + verifiedServicesCount === 0) && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <ShieldCheck className="h-4 w-4 text-teal-700" />
                      <span>Driver Clearance Checklist (Required Before Offering Rides)</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-white p-2.5 flex flex-col justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <BadgeCheck className="h-3.5 w-3.5 text-teal-700" />
                        <span>1. Student Card</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[11px] font-semibold uppercase ${
                            hasStudentCard ? 'text-teal-700' : 'text-amber-700'
                          }`}
                        >
                          {profile?.studentCardStatus || 'unsubmitted'}
                        </span>
                        {!hasStudentCard && (
                          <button
                            type="button"
                            onClick={onOpenProfile}
                            className="text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
                          >
                            Upload
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-2.5 flex flex-col justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <IdCard className="h-3.5 w-3.5 text-teal-700" />
                        <span>2. Admin CNIC Check</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[11px] font-semibold uppercase ${
                            hasCnic
                              ? 'text-teal-700'
                              : profile?.cnicVerificationStatus === 'pending'
                              ? 'text-amber-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {profile?.cnicVerificationStatus === 'pending'
                            ? 'Pending Admin'
                            : profile?.cnicVerificationStatus || 'unsubmitted'}
                        </span>
                        {!hasCnic && (
                          <button
                            type="button"
                            onClick={onOpenProfile}
                            className="text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
                          >
                            Profile
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-2.5 flex flex-col justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <Car className="h-3.5 w-3.5 text-teal-700" />
                        <span>3. Verified Wheels</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[11px] font-semibold ${
                            verifiedVehiclesCount + verifiedServicesCount > 0
                              ? 'text-teal-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {verifiedVehiclesCount + verifiedServicesCount > 0
                            ? `${verifiedVehiclesCount + verifiedServicesCount} Verified`
                            : vehiclesList.length + servicesList.length > 0
                            ? 'Pending Admin'
                            : 'None Added'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSubTab('vehicle')}
                          className="text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {vehiclesList.length === 0 && servicesList.length === 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-amber-900">
                  Add a personal vehicle or carry service with your CNIC image so Campus Admin can verify it manually.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSubTab('vehicle')}
                    className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-900 cursor-pointer"
                  >
                    + Add Vehicle + CNIC
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubTab('carry')}
                    className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-900 cursor-pointer"
                  >
                    + Add Carry + CNIC
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Corridor Route
                </label>
                <select
                  value={routeId}
                  onChange={(e) => setRouteId(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.corridorLabel} ({r.distanceKm} km)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Vehicle or Transport Service
                </label>
                <select
                  value={activeSourceValue}
                  onChange={(e) => setTransportSource(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  {vehiclesList.map((v) => (
                    <option key={`v-${v.id}`} value={`vehicle:${v.id}`}>
                      {v.makeModel} ({v.registrationNumber}) · {v.verificationStatus}
                    </option>
                  ))}
                  {servicesList.map((s) => (
                    <option key={`s-${s.id}`} value={`service:${s.id}`}>
                      {s.serviceName} ({s.driverName}) · {s.verificationStatus}
                    </option>
                  ))}
                </select>
                {selectedSourceInfo && selectedSourceInfo.status !== 'verified' && !profile?.isAdmin && (
                  <p className="mt-1 text-[11px] text-amber-800">
                    Selected {selectedSourceInfo.kind} is currently{' '}
                    <span className="font-semibold uppercase">{selectedSourceInfo.status}</span>{' '}
                    — awaiting manual Campus Admin approval.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Starting Area
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
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Destination Area
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
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Pickup Stops (separate with ·)
              </label>
              <input
                type="text"
                required
                value={pickupPoints}
                onChange={(e) => setPickupPoints(e.target.value)}
                placeholder="D-Ground · Kohinoor Chowk · Gatwala · Loonaywala"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>

            {/* Schedule Mode */}
            <div className="pt-2 border-t border-slate-100 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="h-4 w-4 accent-teal-700 rounded"
                  />
                  <Repeat className="h-4 w-4 text-teal-700" />
                  <span>Recurring Weekly Schedule (generates next 14 days)</span>
                </label>

                <select
                  value={journeyType}
                  onChange={(e) =>
                    setJourneyType(e.target.value as 'morning' | 'evening' | 'round_trip')
                  }
                  className="min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs font-medium"
                >
                  <option value="round_trip">Morning + Return</option>
                  <option value="morning">Morning Only</option>
                  <option value="evening">Evening Only</option>
                </select>
              </div>

              {isRecurring ? (
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => {
                    const active = selectedDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                          active
                            ? 'bg-teal-700 border-teal-700 text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Travel Date
                  </label>
                  <input
                    type="date"
                    required
                    value={travelDate}
                    onChange={(e) => setTravelDate(e.target.value)}
                    className="w-full sm:w-56 min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Departure Time
                  </label>
                  <input
                    type="time"
                    required
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                {journeyType !== 'morning' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Return Time
                    </label>
                    <input
                      type="time"
                      value={returnTime}
                      onChange={(e) => setReturnTime(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Seats Offered
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    required
                    value={offeredSeats}
                    onChange={(e) => setOfferedSeats(Number(e.target.value))}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Cost Sharing */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Estimated Total Daily Cost (PKR)
                </label>
                <input
                  type="number"
                  min={50}
                  step={50}
                  required
                  value={estimatedTotalCost}
                  onChange={(e) => setEstimatedTotalCost(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Cost-Sharing Method
                </label>
                <select
                  value={costMethod}
                  onChange={(e) =>
                    setCostMethod(e.target.value as 'equal_split' | 'fixed_per_seat')
                  }
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="equal_split">Equal Daily Split</option>
                  <option value="fixed_per_seat">Fixed Contribution per Seat</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDriverInSplit}
                  onChange={(e) => setIncludeDriverInSplit(e.target.checked)}
                  className="h-4 w-4 accent-teal-700 rounded"
                />
                <span>Include driver in equal fuel cost split</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-amber-900 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={challanSplitEnabled}
                  onChange={(e) => setChallanSplitEnabled(e.target.checked)}
                  className="h-4 w-4 accent-amber-600 rounded"
                />
                <span>Split any traffic challan equally among everyone on that car</span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Pickup Notes &amp; Vibe Rules
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., AC blasting, meet at gate 5 mins early, cash + any challan split on the spot."
                className="w-full rounded-xl border border-slate-200 p-3 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !canPublishRide}
              className="w-full min-h-[48px] rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {busy
                ? 'Dropping Ride...'
                : !canPublishRide
                ? 'Awaiting Manual Admin Verification to Publish'
                : 'Publish Ride to Squad Board'}
            </button>
          </form>

          {/* Live Cost-Split Preview Sidebar */}
          <aside className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 h-fit">
            <h3 className="text-sm font-semibold text-slate-900">
              Damage Split Preview
            </h3>
            <p className="text-xs text-slate-500">
              Squad pays cash directly on the ride — clean &amp; transparent.
            </p>
            <div className="space-y-2.5 pt-2 border-t border-slate-100 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Total Trip Cost</span>
                <span className="font-mono tabular-nums font-semibold">
                  PKR {estimatedTotalCost}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">With 1 Passenger</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  PKR {splitPreview.projectedWithNewSeat}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">
                  Full Car ({offeredSeats} seats)
                </span>
                <span className="font-mono tabular-nums font-semibold text-teal-700">
                  PKR {splitPreview.fullCapacityPerPerson} / head
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-950">
              {challanSplitEnabled
                ? 'Challan Split ON: Any traffic e-challan or warden ticket gets divided equally among everyone inside the car.'
                : 'Challan Split OFF: Traffic fines are handled directly by the driver.'}
            </div>
          </aside>
        </div>
      )}

      {subTab === 'vehicle' && (
        <form
          onSubmit={handleRegisterVehicle}
          className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-4"
        >
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5 text-teal-700" />
            <h3 className="text-base font-semibold text-slate-900">
              Register Personal Car or Motorcycle
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Vehicle Category
              </label>
              <select
                value={vehCategory}
                onChange={(e) => setVehCategory(e.target.value as 'car' | 'motorcycle')}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              >
                <option value="car">Car</option>
                <option value="motorcycle">Motorcycle (helmet required)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Make &amp; Model
              </label>
              <input
                type="text"
                required
                value={vehModel}
                onChange={(e) => setVehModel(e.target.value)}
                placeholder="e.g., Toyota Corolla GLi 2019"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Registration Number
              </label>
              <input
                type="text"
                required
                value={vehReg}
                onChange={(e) => setVehReg(e.target.value)}
                placeholder="e.g., FSD-19-4021"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Color &amp; Passenger Capacity
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={vehColor}
                  onChange={(e) => setVehColor(e.target.value)}
                  placeholder="Silver"
                  className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  max={7}
                  required
                  value={vehCap}
                  onChange={(e) => setVehCap(Number(e.target.value))}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={vehSelfDriven}
              onChange={(e) => setVehSelfDriven(e.target.checked)}
              className="h-4 w-4 accent-teal-700 rounded"
            />
            <span>I personally drive this vehicle</span>
          </label>

          {!vehSelfDriven && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Actual Driver Full Name
                </label>
                <input
                  type="text"
                  required
                  value={vehDriverName}
                  onChange={(e) => setVehDriverName(e.target.value)}
                  placeholder="Driver's legal name"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Actual Driver Phone
                </label>
                <input
                  type="tel"
                  required
                  value={vehDriverPhone}
                  onChange={(e) => setVehDriverPhone(e.target.value)}
                  placeholder="+92 300 0000000"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono"
                />
              </div>
            </div>
          )}

          {vehSelfDriven && (!profile?.phone || !profile?.fullName) && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Driver Contact Number
              </label>
              <input
                type="tel"
                required
                value={vehDriverPhone}
                onChange={(e) => setVehDriverPhone(e.target.value)}
                placeholder="+92 300 0000000"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono"
              />
            </div>
          )}

          {renderCnicUploadSection('Vehicle Owner')}

          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] px-6 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              {busy ? 'Saving to Database...' : 'Save Vehicle & CNIC for Admin Review'}
            </span>
          </button>
        </form>
      )}

      {subTab === 'carry' && (
        <form
          onSubmit={handleRegisterService}
          className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-4"
        >
          <div className="flex items-center gap-2">
            <Bus className="h-5 w-5 text-teal-700" />
            <h3 className="text-base font-semibold text-slate-900">
              Register Existing Carry or Privately Arranged Driver
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            Student coordinators must record the actual driver’s name and vehicle details, attach their CNIC image for manual Admin review, and confirm authorization to list open seats.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Arrangement Name
              </label>
              <input
                type="text"
                required
                value={srvName}
                onChange={(e) => setSrvName(e.target.value)}
                placeholder="e.g., Peoples Colony Morning Carry"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Service Type
              </label>
              <select
                value={srvType}
                onChange={(e) =>
                  setSrvType(e.target.value as 'carry' | 'van' | 'private_driver')
                }
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              >
                <option value="carry">Carry (Suzuki Bolan / Ravi)</option>
                <option value="van">Hiace / Student Van</option>
                <option value="private_driver">Privately Arranged Driver</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Vehicle Make &amp; Model
              </label>
              <input
                type="text"
                required
                value={srvModel}
                onChange={(e) => setSrvModel(e.target.value)}
                placeholder="e.g., Suzuki Bolan 2021"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Registration Plate &amp; Capacity
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={srvReg}
                  onChange={(e) => setSrvReg(e.target.value)}
                  placeholder="FSD-21-8890"
                  className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono uppercase"
                />
                <input
                  type="number"
                  min={1}
                  max={18}
                  required
                  value={srvCap}
                  onChange={(e) => setSrvCap(Number(e.target.value))}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Actual Driver Name
              </label>
              <input
                type="text"
                required
                value={srvDriverName}
                onChange={(e) => setSrvDriverName(e.target.value)}
                placeholder="e.g., Ustad Muhammad Tariq"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Actual Driver Phone
              </label>
              <input
                type="tel"
                required
                value={srvDriverPhone}
                onChange={(e) => setSrvDriverPhone(e.target.value)}
                placeholder="+92 300 0000000"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Authorization Confirmation
            </label>
            <textarea
              rows={2}
              required
              value={srvAuthNote}
              onChange={(e) => setSrvAuthNote(e.target.value)}
              placeholder="Confirm that the driver/operator authorized you to coordinate student seats on NUCESPOOL."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm"
            />
          </div>

          {renderCnicUploadSection('Carry Coordinator')}

          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] px-6 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer"
          >
            {busy ? 'Saving to Database...' : 'Submit Carry Service & CNIC for Admin Review'}
          </button>
        </form>
      )}
    </div>
  );
};

