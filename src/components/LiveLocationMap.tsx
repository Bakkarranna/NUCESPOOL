import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { LocateFixed, Navigation, Radio, Square, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { LiveLocationPoint } from '../types';

// FAST-NUCES Chiniot-Faisalabad Campus & Corridor Landmarks
const CAMPUS_CENTER = { lat: 31.6025, lng: 73.0358 };
const CHINIOT_CITY = { lat: 31.72, lng: 72.9789 };
const FAISALABAD_DGROUND = { lat: 31.4105, lng: 73.1079 };

interface ParticipantMarkerProps {
  point: LiveLocationPoint;
}

const ParticipantMarker: React.FC<ParticipantMarkerProps> = ({ point }) => {
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
          scale={1.15}
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

interface LiveLocationMapProps {
  rideId: number;
  rideLabel: string;
  userRole: 'driver' | 'passenger';
  onClose?: () => void;
}

export const LiveLocationMap: React.FC<LiveLocationMapProps> = ({
  rideId,
  rideLabel,
  userRole,
  onClose,
}) => {
  const { apiFetch, profile } = useAuth();
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [locations, setLocations] = useState<LiveLocationPoint[]>([]);
  const [sharing, setSharing] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
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

  const fetchLocations = useCallback(async () => {
    try {
      const res = await apiFetch<{ locations: LiveLocationPoint[] }>(
        `/api/rides/${rideId}/locations`
      );
      setLocations(res.locations || []);
    } catch {
      // ignore transient polling error
    }
  }, [apiFetch, rideId]);

  useEffect(() => {
    fetchLocations();
    const timer = window.setInterval(fetchLocations, 4000);
    return () => window.clearInterval(timer);
  }, [fetchLocations]);

  const pushCoordinates = useCallback(
    async (lat: number, lng: number, active: boolean) => {
      try {
        await apiFetch(`/api/rides/${rideId}/location`, {
          method: 'POST',
          body: JSON.stringify({
            lat,
            lng,
            note: statusNote.trim() || (userRole === 'driver' ? 'En route' : 'Waiting at stop'),
            isSharing: active,
          }),
        });
        setLastSentAt(new Date().toLocaleTimeString());
        await fetchLocations();
      } catch (err) {
        setGeoError(err instanceof Error ? err.message : 'Unable to send location.');
      }
    },
    [apiFetch, rideId, statusNote, userRole, fetchLocations]
  );

  const startSharing = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation is not supported in this browser.');
      return;
    }
    setSharing(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pushCoordinates(pos.coords.latitude, pos.coords.longitude, true);
      },
      (err) => {
        setGeoError(
          err.message || 'Location permission denied. Allow GPS access in your browser.'
        );
        setSharing(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        pushCoordinates(pos.coords.latitude, pos.coords.longitude, true);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  };

  const stopSharing = useCallback(async () => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
    await apiFetch(`/api/rides/${rideId}/location`, {
      method: 'POST',
      body: JSON.stringify({ lat: 0, lng: 0, isSharing: false }),
    }).catch(() => {});
    await fetchLocations();
  }, [apiFetch, rideId, fetchLocations]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const primaryCenter =
    locations.length > 0
      ? { lat: locations[0].lat, lng: locations[0].lng }
      : CAMPUS_CENTER;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Navigation className="h-4 w-4 text-teal-700" />
            <span>Squad Live GPS Radar</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{rideLabel}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close live map"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={statusNote}
          onChange={(e) => setStatusNote(e.target.value)}
          placeholder={
            userRole === 'driver'
              ? 'Note (e.g., Crossing Chiniot Bridge)'
              : 'Pickup note (e.g., At Main Gate)'
          }
          className="flex-1 min-w-[200px] min-h-[44px] rounded-xl border border-slate-200 px-3 text-xs"
        />
        {!sharing ? (
          <button
            type="button"
            onClick={startSharing}
            className="min-h-[44px] px-4 rounded-xl bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LocateFixed className="h-4 w-4" />
            <span>
              {userRole === 'passenger'
                ? 'Drop Live Pin to Driver'
                : 'Share Live Driver Radar'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={stopSharing}
            className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-xs font-medium hover:bg-red-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>Stop Sharing</span>
          </button>
        )}
      </div>

      {sharing && (
        <div className="flex items-center gap-2 text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
          <Radio className="h-3.5 w-3.5 animate-pulse text-teal-700" />
          <span>
            Live GPS sharing active{lastSentAt ? ` · Last updated ${lastSentAt}` : ''}. Only verified ride participants can see your pin.
          </span>
        </div>
      )}

      {geoError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {geoError}
        </div>
      )}

      {/* Map Viewport (Explicit height prevents 0x0 collapse) */}
      <div className="h-72 sm:h-80 w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        {mapsApiKey ? (
          <APIProvider apiKey={mapsApiKey} libraries={['marker']}>
            <GoogleMap
              mapId="DEMO_MAP_ID"
              defaultCenter={primaryCenter}
              defaultZoom={11}
              gestureHandling="greedy"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%' }}
            >
              {/* FAST-NUCES Chiniot-Faisalabad Campus Pin */}
              <AdvancedMarker
                position={CAMPUS_CENTER}
                title="FAST-NUCES Chiniot-Faisalabad Campus"
              >
                <Pin
                  background="#0F172A"
                  borderColor="#0F172A"
                  glyphColor="#FFFFFF"
                  scale={0.95}
                />
              </AdvancedMarker>

              {/* Corridor Anchor Pins */}
              <AdvancedMarker position={CHINIOT_CITY} title="Chiniot City">
                <Pin background="#64748B" borderColor="#475569" glyphColor="#FFFFFF" scale={0.8} />
              </AdvancedMarker>
              <AdvancedMarker position={FAISALABAD_DGROUND} title="Faisalabad (D-Ground)">
                <Pin background="#64748B" borderColor="#475569" glyphColor="#FFFFFF" scale={0.8} />
              </AdvancedMarker>

              {/* Live Participant Pins */}
              {locations.map((loc) => (
                <ParticipantMarker key={loc.userId} point={loc} />
              ))}
            </GoogleMap>
          </APIProvider>
        ) : (
          <div className="h-full flex items-center justify-center p-6 text-center text-xs text-slate-500">
            Loading Google Maps configuration...
          </div>
        )}
      </div>

      {/* Active Participants List */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">
          Active Shared Locations ({locations.length})
        </div>
        {locations.length === 0 ? (
          <p className="text-xs text-slate-500">
            No live pins active yet. Click &ldquo;Share My Live Location&rdquo; above to broadcast your real-time pickup coordinates.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {locations.map((loc) => (
              <div
                key={loc.userId}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    {loc.fullName}
                    {loc.userId === profile?.id ? ' (You)' : ''} ·{' '}
                    <span className="capitalize text-teal-700">{loc.role}</span>
                  </div>
                  <div className="text-slate-500 truncate">
                    {loc.note || 'Sharing live coordinates'}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-[10px] text-slate-400 shrink-0">
                  {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
