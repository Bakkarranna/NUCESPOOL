import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Phone,
  Radio,
  ShieldAlert,
  Siren,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { LiveLocationPoint, SosAlertItem } from '../types';

const CAMPUS_CENTER = { lat: 31.6025, lng: 73.0358 };

interface SosPinProps {
  alert: SosAlertItem;
}

const SosAlertMarker: React.FC<SosPinProps> = ({ alert }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(true);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: alert.lat, lng: alert.lng }}
        onClick={() => setOpen((prev) => !prev)}
        title={`SOS from ${alert.triggeredByName}`}
      >
        <Pin
          background="#DC2626"
          borderColor="#7F1D1D"
          glyphColor="#FFFFFF"
          scale={1.35}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} maxWidth={250}>
          <div className="text-xs text-slate-900 space-y-1 p-0.5">
            <div className="font-bold text-red-700">
              SOS · {alert.triggeredByName}
            </div>
            {alert.triggeredByRollNumber && (
              <div className="font-mono text-[10px] text-slate-500">
                Roll {alert.triggeredByRollNumber}
              </div>
            )}
            {alert.message && <div className="text-slate-800">{alert.message}</div>}
            <div className="font-mono text-[10px] text-slate-500">
              {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}
              {alert.accuracyMeters ? ` (±${alert.accuracyMeters}m)` : ''}
            </div>
            <div className="font-mono text-[10px] text-slate-400">
              {new Date(alert.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface SquadLocMarkerProps {
  point: LiveLocationPoint;
}

const SquadLocMarker: React.FC<SquadLocMarkerProps> = ({ point }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  const isDriver = point.role === 'driver';
  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: point.lat, lng: point.lng }}
        onClick={() => setOpen((prev) => !prev)}
        title={`${point.fullName} (${point.role})`}
      >
        <Pin
          background={isDriver ? '#0F766E' : '#0284C7'}
          borderColor={isDriver ? '#115E59' : '#0369A1'}
          glyphColor="#FFFFFF"
          scale={1.05}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} maxWidth={220}>
          <div className="text-xs text-slate-900 space-y-1 p-0.5">
            <div className="font-semibold">
              {point.fullName} ({isDriver ? 'Driver' : 'Passenger'})
            </div>
            {point.note && <div className="text-slate-600">{point.note}</div>}
            <div className="font-mono text-[10px] text-slate-500">
              Updated {new Date(point.updatedAt).toLocaleTimeString()}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface RideSosPanelProps {
  rideId: number;
  rideLabel: string;
  isParticipant: boolean;
  isDriver: boolean;
  expanded: boolean;
  onExpandChange: (open: boolean) => void;
  onActiveAlertsCountChange?: (count: number) => void;
}

export const RideSosPanel: React.FC<RideSosPanelProps> = ({
  rideId,
  rideLabel,
  isParticipant,
  isDriver,
  expanded,
  onExpandChange,
  onActiveAlertsCountChange,
}) => {
  const { firebaseUser, profile, apiFetch, refreshAll } = useAuth();
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [alerts, setAlerts] = useState<SosAlertItem[]>([]);
  const [locations, setLocations] = useState<LiveLocationPoint[]>([]);
  const [sosNote, setSosNote] = useState('');
  const [sending, setSending] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [liveSharing, setLiveSharing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [geoWarning, setGeoWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapsApiKey) {
      fetch('/api/public/maps-config')
        .then((r) => r.json())
        .then((data) => {
          if (data?.apiKey) setMapsApiKey(data.apiKey);
        })
        .catch(() => {});
    }
  }, [mapsApiKey]);

  const stopWatcher = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLiveSharing(false);
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [rideId]);

  const fetchSosState = useCallback(async () => {
    if (!firebaseUser || !isParticipant) return;
    try {
      const res = await apiFetch<{
        alerts: SosAlertItem[];
        locations: LiveLocationPoint[];
      }>(`/api/rides/${rideId}/sos`);
      const fetchedAlerts = res.alerts || [];
      setAlerts(fetchedAlerts);
      setLocations(res.locations || []);
      const activeCount = fetchedAlerts.filter((a) => a.status === 'active').length;
      onActiveAlertsCountChange?.(activeCount);
      if (activeCount > 0 && !expanded) {
        onExpandChange(true);
      }
    } catch {
      // ignore transient errors for background polling
    }
  }, [
    firebaseUser,
    isParticipant,
    apiFetch,
    rideId,
    onActiveAlertsCountChange,
    expanded,
    onExpandChange,
  ]);

  useEffect(() => {
    if (!firebaseUser || !isParticipant) return;
    fetchSosState();
    const timer = window.setInterval(fetchSosState, 4000);
    return () => window.clearInterval(timer);
  }, [firebaseUser, isParticipant, fetchSosState]);

  const startLiveTracking = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    setLiveSharing(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        apiFetch(`/api/rides/${rideId}/location`, {
          method: 'POST',
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            note: `SOS Live GPS (±${Math.round(pos.coords.accuracy || 0)}m)`,
            isSharing: true,
          }),
        })
          .then(() => fetchSosState())
          .catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 }
    );
  }, [apiFetch, rideId, fetchSosState]);

  const triggerSos = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setGeoWarning(null);
    setStatusMsg(null);
    setSending(true);

    const getBrowserCoords = (): Promise<{
      lat?: number;
      lng?: number;
      accuracyMeters?: number;
      warning?: string;
    }> =>
      new Promise((resolve) => {
        if (!('geolocation' in navigator)) {
          resolve({
            warning:
              'Browser geolocation is unavailable; SOS alert sent with campus corridor anchor.',
          });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyMeters: Math.round(pos.coords.accuracy || 0),
            });
          },
          (geoErr) => {
            resolve({
              warning: `GPS permission unavailable (${geoErr.message}); SOS alert sent immediately with corridor pin.`,
            });
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });

    try {
      const coords = await getBrowserCoords();
      if (coords.warning) setGeoWarning(coords.warning);

      const res = await apiFetch<{
        alert: SosAlertItem;
        alertedCount: number;
      }>(`/api/rides/${rideId}/sos`, {
        method: 'POST',
        body: JSON.stringify({
          lat: coords.lat,
          lng: coords.lng,
          accuracyMeters: coords.accuracyMeters,
          message: sosNote.trim() || undefined,
        }),
      });

      if (coords.lat !== undefined && coords.lng !== undefined) {
        startLiveTracking();
      }
      setStatusMsg(
        `SOS alert sent to ${res.alertedCount} squad member${res.alertedCount === 1 ? '' : 's'} & campus admins with live location!`
      );
      await Promise.all([fetchSosState(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to trigger SOS alert.');
    } finally {
      setSending(false);
    }
  };

  const resolveSos = async (alertId: number) => {
    setResolvingId(alertId);
    setError(null);
    try {
      await apiFetch(`/api/rides/${rideId}/sos/${alertId}/resolve`, {
        method: 'PATCH',
      });
      stopWatcher();
      setStatusMsg('SOS alert marked safe / resolved.');
      await Promise.all([fetchSosState(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve SOS alert.');
    } finally {
      setResolvingId(null);
    }
  };

  const activeAlerts = alerts.filter((a) => a.status === 'active');
  const myActiveAlert = activeAlerts.find((a) => a.triggeredByUserId === profile?.id);

  if (!expanded && activeAlerts.length === 0) {
    return null;
  }

  const mapCenter =
    activeAlerts.length > 0
      ? { lat: activeAlerts[0].lat, lng: activeAlerts[0].lng }
      : locations.length > 0
      ? { lat: locations[0].lat, lng: locations[0].lng }
      : CAMPUS_CENTER;

  return (
    <div className="mt-5 rounded-2xl border-2 border-red-200 bg-red-50/60 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0">
            <Siren className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-red-950">
              SOS / Emergency Squad Alert &amp; Real-Time Location
            </h4>
            <p className="text-[11px] text-red-800">
              Alerts all squad members on {rideLabel} + Campus Admins with your live Google Maps pin.
            </p>
          </div>
        </div>
        {activeAlerts.length === 0 && (
          <button
            type="button"
            onClick={() => onExpandChange(false)}
            className="text-xs font-medium text-red-700 hover:underline cursor-pointer"
          >
            Minimize
          </button>
        )}
      </div>

      {/* Active Alerts List */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2.5">
          {activeAlerts.map((alert) => {
            const canResolve =
              alert.triggeredByUserId === profile?.id || isDriver || profile?.isAdmin;
            const googleMapsLink = `https://www.google.com/maps?q=${alert.lat.toFixed(6)},${alert.lng.toFixed(6)}`;
            return (
              <div
                key={alert.id}
                className="rounded-xl bg-white border border-red-300 p-3.5 shadow-sm space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-red-700">
                      <Radio className="h-3.5 w-3.5 animate-pulse" />
                      <span>
                        ACTIVE SOS · {alert.triggeredByName}
                        {alert.triggeredByRollNumber ? ` (${alert.triggeredByRollNumber})` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-slate-800">{alert.message}</p>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-red-600" />
                        {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}
                      </span>
                      {alert.triggeredByPhone && (
                        <a
                          href={`tel:${alert.triggeredByPhone}`}
                          className="inline-flex items-center gap-1 text-teal-700 font-semibold hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {alert.triggeredByPhone}
                        </a>
                      )}
                      <a
                        href={googleMapsLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-red-700 font-semibold underline"
                      >
                        Open Coordinates
                      </a>
                    </div>
                  </div>
                  {canResolve && (
                    <button
                      type="button"
                      disabled={resolvingId === alert.id}
                      onClick={() => resolveSos(alert.id)}
                      className="min-h-[36px] px-3 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {resolvingId === alert.id ? 'Resolving...' : 'Mark Safe / Resolve'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isParticipant ? (
        <div className="rounded-xl bg-white border border-red-200 p-3 text-xs text-slate-700">
          Join or host this ride (or sign in as Campus Admin) to trigger or view real-time SOS coordinates for this squad.
        </div>
      ) : (
        <>
          {/* Trigger / Update SOS Form */}
          <form onSubmit={triggerSos} className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {[
                'Car breakdown on highway',
                'Need urgent pickup or help',
                'Unsafe spot on route. Sharing live pin.',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSosNote(preset)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-red-200 text-[11px] font-medium text-red-800 hover:bg-red-100 cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={sosNote}
                onChange={(e) => setSosNote(e.target.value)}
                placeholder="Optional note (e.g., Flat tire near Loonaywala stop)"
                className="flex-1 min-h-[42px] rounded-xl border border-red-200 bg-white px-3 text-xs"
              />
              <button
                type="submit"
                disabled={sending}
                className="min-h-[42px] px-4 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <ShieldAlert className="h-4 w-4" />
                {sending
                  ? 'Sending SOS & GPS...'
                  : myActiveAlert
                  ? 'Update Live SOS Pin'
                  : 'Send SOS Alert & Share Live Location'}
              </button>
            </div>
          </form>

          {liveSharing && (
            <div className="flex items-center gap-2 text-xs text-red-900 bg-red-100 border border-red-200 rounded-xl px-3 py-2">
              <Radio className="h-3.5 w-3.5 animate-pulse text-red-700" />
              <span>
                Live GPS is streaming. Your pin keeps updating on squad maps until someone marks you safe.
              </span>
            </div>
          )}

          {geoWarning && (
            <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{geoWarning}</span>
            </div>
          )}

          {statusMsg && (
            <div className="text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
              {statusMsg}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-800 bg-white border border-red-300 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {/* Embedded Google Maps Real-Time SOS Viewport */}
          <div className="h-64 w-full rounded-xl overflow-hidden border border-red-200 bg-slate-100">
            {mapsApiKey ? (
              <APIProvider apiKey={mapsApiKey} libraries={['marker']}>
                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  defaultCenter={mapCenter}
                  center={activeAlerts.length > 0 ? mapCenter : undefined}
                  defaultZoom={activeAlerts.length > 0 ? 13 : 11}
                  gestureHandling="greedy"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  style={{ width: '100%', height: '100%' }}
                >
                  {activeAlerts.map((alert) => (
                    <SosAlertMarker key={`sos-${alert.id}`} alert={alert} />
                  ))}
                  {locations
                    .filter((loc) => !activeAlerts.some((a) => a.triggeredByUserId === loc.userId))
                    .map((loc) => (
                      <SquadLocMarker key={`loc-${loc.userId}`} point={loc} />
                    ))}
                </GoogleMap>
              </APIProvider>
            ) : (
              <div className="h-full flex items-center justify-center p-4 text-xs text-slate-500">
                Loading Google Maps live SOS radar...
              </div>
            )}
          </div>
        </>
      )}

      <p className="text-[11px] text-red-900/80">
        This pings everyone on the ride and campus admins. For life-threatening emergencies, call Police 15 or Rescue 1122 directly.
      </p>
    </div>
  );
};
