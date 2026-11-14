import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Calculator,
  Calendar,
  Compass,
  Menu,
  MessageSquare,
  PlusCircle,
  Search,
  Shield,
  Ticket,
  User,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { computeRideCompatibility, getDayClassWindow } from './lib/matching';
import type { RideItem } from './types';
import { Avatar } from './components/Avatar';
import { RideCard } from './components/RideCard';
import { RideDetailModal } from './components/RideDetailModal';
import { OfferRideView } from './components/OfferRideView';
import { MyRidesView } from './components/MyRidesView';
import { TimetableView } from './components/TimetableView';
import { MessagesView } from './components/MessagesView';
import { ProfileView } from './components/ProfileView';
import { AdminConsoleView } from './components/AdminConsoleView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

type NavView =
  | 'discover'
  | 'offer'
  | 'rides'
  | 'timetable'
  | 'messages'
  | 'profile'
  | 'admin';

const VIEW_TITLES: Record<NavView, string> = {
  discover: 'Find Your Ride',
  offer: 'Drop a Ride',
  rides: 'My Squad & Trips',
  timetable: 'Timetable Match',
  messages: 'Squad Chat',
  profile: 'Campus Flex & ID',
  admin: 'Boss Console',
};

function MainShell() {
  const {
    firebaseUser,
    profile,
    workspace,
    catalog,
    loadingData,
    authError,
    signInWithGoogle,
    apiFetch,
    refreshAll,
  } = useAuth();

  const [view, setView] = useState<NavView>('discover');
  const [viewHistory, setViewHistory] = useState<NavView[]>([]);
  const [selectedRide, setSelectedRide] = useState<RideItem | null>(null);
  const [chatThread, setChatThread] = useState<{
    rideId: number;
    otherUserId: number;
  } | null>(null);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const notifDrawerRef = useRef<HTMLElement | null>(null);
  const notifButtonRef = useRef<HTMLButtonElement | null>(null);

  // Google Maps Platform Case A Two-Tier Quota Defense (Tier 2)
  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  useEffect(() => {
    if (!showNotifDrawer && !showMobileMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showMobileMenu) setShowMobileMenu(false);
        if (showNotifDrawer) setShowNotifDrawer(false);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!showNotifDrawer) return;
      const target = e.target as Node;
      if (
        notifDrawerRef.current &&
        !notifDrawerRef.current.contains(target) &&
        (!notifButtonRef.current || !notifButtonRef.current.contains(target))
      ) {
        setShowNotifDrawer(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [showNotifDrawer, showMobileMenu]);

  const navigateTo = (nextView: NavView) => {
    if (nextView === view) return;
    setViewHistory((prev) => [...prev.slice(-10), view]);
    setView(nextView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    if (viewHistory.length === 0) {
      setView('discover');
      return;
    }
    const previous = viewHistory[viewHistory.length - 1];
    setViewHistory((prev) => prev.slice(0, -1));
    setView(previous);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Search & Filter State (FR-05)
  const [direction, setDirection] = useState<string>('all');
  const [travelDate, setTravelDate] = useState<string>('');
  const [journeyFilter, setJourneyFilter] = useState<string>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');
  const [minSeats, setMinSeats] = useState<number>(1);
  const [maxCost, setMaxCost] = useState<number>(1500);
  const [queryText, setQueryText] = useState<string>('');

  // Standalone Daily Cost & Challan Split Calculator (FR-09)
  const [calcTotalCost, setCalcTotalCost] = useState<number>(1000);
  const [calcChallanCost, setCalcChallanCost] = useState<number>(0);
  const [calcPassengers, setCalcPassengers] = useState<number>(3);
  const [calcIncludeDriver, setCalcIncludeDriver] = useState<boolean>(false);

  const calcDivisor = Math.max(1, calcPassengers + (calcIncludeDriver ? 1 : 0));
  const calcCarHeadcount = calcPassengers + 1; // everyone inside the car splits challans
  const calcFuelPerPerson = Math.round(calcTotalCost / calcDivisor);
  const calcChallanPerPerson =
    calcChallanCost > 0 ? Math.round(calcChallanCost / calcCarHeadcount) : 0;
  const calcPerPerson = String(calcFuelPerPerson + calcChallanPerPerson);

  const unreadNotifs =
    workspace?.notifications.filter((n) => !n.isRead).length ?? 0;

  const timetableSlots = workspace?.timetable ?? [];

  const filteredRides = useMemo(() => {
    const list = catalog?.rides ?? [];
    return list
      .filter((r) => {
        if (direction !== 'all') {
          const dir = `${r.originCity}->${r.destinationCity}`;
          if (dir !== direction) return false;
        }
        if (travelDate && r.travelDate !== travelDate) return false;
        if (journeyFilter !== 'all' && r.journeyType !== journeyFilter) return false;
        if (r.availableSeats < minSeats) return false;
        if (r.costSplit.currentPerPerson > maxCost) return false;
        if (vehicleFilter === 'car' && r.vehicle?.category !== 'car') return false;
        if (vehicleFilter === 'motorcycle' && r.vehicle?.category !== 'motorcycle')
          return false;
        if (vehicleFilter === 'carry' && !r.transportService) return false;
        if (queryText.trim()) {
          const q = queryText.toLowerCase();
          const hay =
            `${r.originCity} ${r.originArea} ${r.destinationCity} ${r.destinationArea} ${r.pickupPoints} ${r.provider?.fullName || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((ride) => {
        const win = getDayClassWindow(timetableSlots, ride.travelDate);
        return {
          ride,
          match:
            profile || timetableSlots.length > 0
              ? computeRideCompatibility({
                  rideOriginCity: ride.originCity,
                  rideDestinationCity: ride.destinationCity,
                  ridePickupPoints: ride.pickupPoints,
                  rideDepartureTime: ride.departureTime,
                  rideReturnTime: ride.returnTime,
                  userHomeArea: profile?.homeArea,
                  userPreferredDeparture: profile?.preferredDeparture,
                  userPreferredReturn: profile?.preferredReturn,
                  userFirstClassTime: win.firstClassTime,
                  userLastClassTime: win.lastClassTime,
                  preferredDirection: direction,
                })
              : null,
        };
      });
  }, [
    catalog?.rides,
    direction,
    travelDate,
    journeyFilter,
    minSeats,
    maxCost,
    vehicleFilter,
    queryText,
    profile,
    timetableSlots,
  ]);

  const handleOpenChat = (rideId: number, otherUserId: number) => {
    setChatThread({ rideId, otherUserId });
    navigateTo('messages');
  };

  const handleMarkNotificationsRead = async () => {
    setShowNotifDrawer((prev) => !prev);
    if (unreadNotifs > 0 && firebaseUser) {
      await apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(
        () => {}
      );
      await refreshAll();
    }
  };

  const navItems: { id: NavView; label: string }[] = [
    { id: 'discover', label: 'Find Ride' },
    { id: 'offer', label: 'Drop Ride' },
    { id: 'rides', label: 'My Trips' },
    { id: 'timetable', label: 'Timetable' },
    { id: 'messages', label: 'Squad Chat' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 md:pb-12">
      {/* Google Maps Platform Case A Quota Exceeded Top Banner */}
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Desktop & Mobile Top Header (3-zone contract, <=56px on mobile) */}
      <header className="sticky top-0 z-30 h-[52px] md:h-16 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateTo('discover')}
            className="text-lg font-extrabold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0 cursor-pointer"
          >
            NUCESPOOL
          </button>

          {/* Zone 2: Clean single-line text nav links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                  view === item.id
                    ? 'border-teal-700 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
            {profile?.isAdmin && (
              <button
                type="button"
                onClick={() => navigateTo('admin')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                  view === 'admin'
                    ? 'border-teal-700 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                Admin
              </button>
            )}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            {firebaseUser ? (
              <button
                type="button"
                onClick={() => navigateTo('profile')}
                className="min-h-[40px] pl-1.5 pr-3.5 py-1 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2 cursor-pointer"
              >
                <Avatar
                  name={profile?.fullName}
                  avatarUrl={profile?.avatarUrl}
                  size="sm"
                />
                <span>{profile?.fullName?.split(' ')[0] || 'Account'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {authError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800">
            {authError}
          </div>
        )}

        {/* Back Button on All Non-Home Pages */}
        {view !== 'discover' && (
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={goBack}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 inline-flex items-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4 text-teal-700" />
              <span>Back</span>
            </button>
            <span className="text-xs font-medium text-slate-500">
              {VIEW_TITLES[view]}
            </span>
          </div>
        )}

        {view === 'discover' && (
          <>
            {/* Focused Hero Toolbar */}
            <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="max-w-2xl space-y-2">
                <p className="text-xs font-medium text-teal-700">
                  FAST-NUCES Chiniot-Faisalabad · Verified Campus Gang Only
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-display [text-wrap:balance]">
                  Chiniot ↔ Faisalabad carpools, carry scenes &amp; zero solo commute stress.
                </h1>
                <p className="text-sm text-slate-600">
                  Lock in your seat, match with your timetable, share live pins, and split fuel + any traffic challan fairly in cash with your campus squad.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <PWAInstallButton />
                {firebaseUser && (
                  <button
                    ref={notifButtonRef}
                    type="button"
                    onClick={handleMarkNotificationsRead}
                    className="relative min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Bell className="h-4 w-4 text-slate-600" />
                    <span>Pings</span>
                    {unreadNotifs > 0 && (
                      <span className="font-mono tabular-nums font-semibold text-teal-700">
                        ({unreadNotifs})
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigateTo('offer')}
                  className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Drop a Ride
                </button>
              </div>
            </section>

            {/* Notifications Drawer */}
            {showNotifDrawer && workspace && (
              <section
                ref={notifDrawerRef}
                className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Recent Ride Notifications
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowNotifDrawer(false)}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    Close
                  </button>
                </div>
                {workspace.notifications.length === 0 ? (
                  <p className="text-xs text-slate-500">No notifications yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {workspace.notifications.slice(0, 6).map((n) => (
                      <div key={n.id} className="py-2.5 flex justify-between gap-4 text-xs">
                        <div>
                          <span className="font-semibold text-slate-900">{n.title}</span>
                          <span className="text-slate-600"> — {n.body}</span>
                        </div>
                        <span className="font-mono text-slate-400 whitespace-nowrap">
                          {new Date(n.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Filter Bar */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <div className="lg:col-span-2 relative">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    placeholder="Search stop, area, or buddy..."
                    className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>

                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  aria-label="Corridor direction"
                  className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">All Corridors</option>
                  <option value="Chiniot->Faisalabad">Chiniot → Faisalabad</option>
                  <option value="Faisalabad->Chiniot">Faisalabad → Chiniot</option>
                </select>

                <input
                  type="date"
                  value={travelDate}
                  onChange={(e) => setTravelDate(e.target.value)}
                  aria-label="Travel date"
                  className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                />

                <select
                  value={journeyFilter}
                  onChange={(e) => setJourneyFilter(e.target.value)}
                  aria-label="Time of day"
                  className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">Morning &amp; Evening</option>
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                  <option value="round_trip">Round Trip</option>
                </select>

                <select
                  value={vehicleFilter}
                  onChange={(e) => setVehicleFilter(e.target.value)}
                  aria-label="Vehicle type"
                  className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">All Vehicles</option>
                  <option value="car">Personal Cars</option>
                  <option value="carry">Carry / Van Services</option>
                  <option value="motorcycle">Motorcycles</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2">
                    <span>Min seats:</span>
                    <select
                      value={minSeats}
                      onChange={(e) => setMinSeats(Number(e.target.value))}
                      className="rounded-lg border border-slate-200 px-2 py-1 font-mono"
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}+
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <span>Max est. cost:</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      PKR {maxCost}
                    </span>
                    <input
                      type="range"
                      min={200}
                      max={1500}
                      step={50}
                      value={maxCost}
                      onChange={(e) => setMaxCost(Number(e.target.value))}
                      className="accent-teal-700"
                    />
                  </label>
                </div>

                {(direction !== 'all' ||
                  travelDate ||
                  journeyFilter !== 'all' ||
                  vehicleFilter !== 'all' ||
                  queryText) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('all');
                      setTravelDate('');
                      setJourneyFilter('all');
                      setVehicleFilter('all');
                      setMinSeats(1);
                      setMaxCost(1500);
                      setQueryText('');
                    }}
                    className="text-teal-700 font-medium hover:underline cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </section>

            {/* Main 2-Column Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 8 Columns: Ride Discovery Feed */}
              <div className="lg:col-span-8 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900 font-display">
                    Active Rides ({filteredRides.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => navigateTo('timetable')}
                    className="text-xs font-medium text-teal-700 hover:underline cursor-pointer"
                  >
                    Sync with Timetable →
                  </button>
                </div>

                {loadingData && !catalog ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className="h-52 bg-white border border-slate-200 rounded-2xl animate-pulse"
                      />
                    ))}
                  </div>
                ) : filteredRides.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
                    <p className="text-sm text-slate-600">
                      Dead scene here — no rides match those filters right now.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigateTo('offer')}
                      className="min-h-[44px] px-5 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer"
                    >
                      Drop a Ride for This Route
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredRides.map(({ ride, match }) => (
                      <RideCard
                        key={ride.id}
                        ride={ride}
                        match={match}
                        onSelect={setSelectedRide}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Right 4 Columns: Daily Damage & Challan Split Calculator & Campus Code */}
              <aside className="lg:col-span-4 space-y-5">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-teal-700" />
                    <h3 className="text-sm font-semibold text-slate-900 font-display">
                      Fuel &amp; Challan Split Calculator
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500">
                    Calculate everyone&apos;s per-head cash damage — fuel plus any surprise e-challan or warden fine split across the whole car.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>Total Daily Fuel / Trip Cost (PKR)</span>
                        <span className="font-mono tabular-nums">PKR {calcTotalCost}</span>
                      </label>
                      <input
                        type="number"
                        min={100}
                        step={50}
                        value={calcTotalCost}
                        onChange={(e) => setCalcTotalCost(Math.max(50, Number(e.target.value)))}
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>Traffic Challan on Ride (PKR, optional)</span>
                        <span className="font-mono tabular-nums">PKR {calcChallanCost}</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={calcChallanCost}
                        onChange={(e) => setCalcChallanCost(Math.max(0, Number(e.target.value)))}
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>Passengers in Car</span>
                        <span className="font-mono tabular-nums">{calcPassengers}</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        value={calcPassengers}
                        onChange={(e) => setCalcPassengers(Number(e.target.value))}
                        className="w-full accent-teal-700"
                      />
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={calcIncludeDriver}
                        onChange={(e) => setCalcIncludeDriver(e.target.checked)}
                        className="h-4 w-4 accent-teal-700 rounded"
                      />
                      <span>Include driver in fuel split</span>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-100 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-slate-600">Total damage per head</span>
                      <span className="font-mono tabular-nums text-xl font-bold text-teal-700">
                        PKR {calcPerPerson}
                      </span>
                    </div>
                    {calcChallanPerPerson > 0 && (
                      <div className="text-[11px] text-amber-800 font-mono tabular-nums">
                        Fuel PKR {calcFuelPerPerson} + Challan PKR {calcChallanPerPerson} (÷ {calcCarHeadcount} in car)
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2.5 text-xs text-slate-600">
                  <h3 className="text-sm font-semibold text-slate-900 font-display">
                    The Campus Code (No Cap)
                  </h3>
                  <p>1. Verified FAST-NUCES Chiniot squad only — zero outsiders.</p>
                  <p>2. Cash shares are sorted upfront &amp; settled directly on the trip.</p>
                  <p>3. Got hit with a traffic challan? It splits equally among everyone sitting in that car.</p>
                  <p>4. No ghosting — bail early if plans change so others can grab the seat.</p>
                </div>
              </aside>
            </div>
          </>
        )}

        {view === 'offer' && (
          <OfferRideView
            onPublished={() => navigateTo('rides')}
            onOpenProfile={() => navigateTo('profile')}
          />
        )}

        {view === 'rides' && (
          <MyRidesView
            onOpenChat={handleOpenChat}
            onFindNewRide={() => navigateTo('discover')}
          />
        )}

        {view === 'timetable' && <TimetableView onSelectRide={setSelectedRide} />}

        {view === 'messages' && <MessagesView initialThread={chatThread} />}

        {view === 'profile' && <ProfileView />}

        {view === 'admin' && <AdminConsoleView />}
      </main>

      {/* Mobile Bottom Thumb Navigation (<=56px, total sticky <=108px < 15% cap) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 pb-safe bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center"
      >
        {[
          { id: 'discover' as const, label: 'Find', icon: Compass },
          { id: 'offer' as const, label: 'Offer', icon: PlusCircle },
          { id: 'rides' as const, label: 'Trips', icon: Ticket },
          { id: 'messages' as const, label: 'Chat', icon: MessageSquare },
        ].map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setShowMobileMenu(false);
                navigateTo(item.id);
              }}
              className={`h-full flex flex-col items-center justify-center gap-0.5 ${
                active ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setShowMobileMenu(true)}
          className={`h-full flex flex-col items-center justify-center gap-0.5 ${
            ['timetable', 'profile', 'admin'].includes(view)
              ? 'text-teal-700'
              : 'text-slate-500'
          }`}
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium tracking-tight">More</span>
        </button>
      </nav>

      {/* Mobile More Bottom Sheet */}
      {showMobileMenu && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMobileMenu(false);
          }}
          className="md:hidden fixed inset-0 z-50 flex items-end bg-slate-900/50 backdrop-blur-sm cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-white border-t border-slate-200 p-6 space-y-3 cursor-default"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-900">More Tools</span>
              <button
                type="button"
                onClick={() => setShowMobileMenu(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                navigateTo('timetable');
                setShowMobileMenu(false);
              }}
              className="w-full min-h-[48px] px-4 rounded-xl flex items-center gap-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <Calendar className="h-4 w-4 text-teal-700" />
              <span>Timetable &amp; Schedule Matches</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigateTo('profile');
                setShowMobileMenu(false);
              }}
              className="w-full min-h-[48px] px-4 rounded-xl flex items-center gap-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <User className="h-4 w-4 text-teal-700" />
              <span>Profile &amp; FAST Verification</span>
            </button>
            {profile?.isAdmin && (
              <button
                type="button"
                onClick={() => {
                  navigateTo('admin');
                  setShowMobileMenu(false);
                }}
                className="w-full min-h-[48px] px-4 rounded-xl flex items-center gap-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <Shield className="h-4 w-4 text-teal-700" />
                <span>Admin Moderation Console</span>
              </button>
            )}
            <div className="pt-2">
              <PWAInstallButton />
            </div>
          </div>
        </div>
      )}

      {/* Ride Detail & Request Modal */}
      <RideDetailModal
        ride={selectedRide}
        onClose={() => setSelectedRide(null)}
        onBooked={() => navigateTo('rides')}
        onOpenProfile={() => navigateTo('profile')}
      />

      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainShell />
    </AuthProvider>
  );
}
