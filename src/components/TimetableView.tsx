import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { computeRideCompatibility, getDayClassWindow } from '../lib/matching';
import type { RideItem, TimetableSlot } from '../types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface TimetableViewProps {
  onSelectRide: (ride: RideItem) => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export const TimetableView: React.FC<TimetableViewProps> = ({ onSelectRide }) => {
  const { firebaseUser, profile, workspace, catalog, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();

  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [fileType, setFileType] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace?.timetable && workspace.timetable.length > 0) {
      setSlots(workspace.timetable);
      setFileName(workspace.timetable[0]?.uploadedFileName || '');
      setFileType(workspace.timetable[0]?.uploadedFileType || '');
    } else if (workspace) {
      setSlots([
        {
          dayOfWeek: 'Mon',
          courseName: 'Morning Lecture',
          room: 'CS-1',
          classStartTime: '08:30',
          classEndTime: '10:00',
          campusName: 'FAST-NUCES Chiniot-Faisalabad Campus',
        },
        {
          dayOfWeek: 'Mon',
          courseName: 'Afternoon Lab',
          room: 'Lab-2',
          classStartTime: '13:30',
          classEndTime: '15:15',
          campusName: 'FAST-NUCES Chiniot-Faisalabad Campus',
        },
      ]);
    }
  }, [workspace]);

  const rankedMatches = useMemo(() => {
    const rides = catalog?.rides ?? [];
    return rides
      .filter((r) => r.availableSeats > 0)
      .map((ride) => {
        const win = getDayClassWindow(slots, ride.travelDate);
        return {
          ride,
          dayWindow: win,
          match: computeRideCompatibility({
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
          }),
        };
      })
      .sort((a, b) => b.match.totalScore - a.match.totalScore);
  }, [catalog?.rides, slots, profile]);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSavedMsg(null);

    if (!firebaseUser) {
      setError('Please sign in first to analyze and save your timetable.');
      return;
    }

    const validExt = /\.(pdf|jpg|jpeg|png|webp|csv|txt)$/i.test(file.name);
    if (!validExt) {
      setError('Unsupported format. Please upload PDF, JPG, PNG, WEBP, CSV, or TXT.');
      return;
    }

    setFileName(file.name);
    setFileType(file.type || 'application/octet-stream');
    setParsing(true);

    try {
      const isText = /\.(csv|txt)$/i.test(file.name) || file.type.startsWith('text/');
      const payload = isText
        ? {
            fileName: file.name,
            mimeType: file.type || 'text/plain',
            textContent: await file.text(),
          }
        : {
            fileName: file.name,
            mimeType: file.type || 'application/pdf',
            base64Data: await readFileAsBase64(file),
          };

      const res = await apiFetch<{ timetable: TimetableSlot[]; extractedCount: number }>(
        '/api/timetable/parse',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      setSlots(res.timetable);
      await refreshAll();
      setSavedMsg(
        `Pulled ${res.extractedCount} classes from ${file.name} and updated your ride matches.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not extract timetable details from the uploaded file.'
      );
    } finally {
      setParsing(false);
    }
  };

  const addClassForDay = (day: string) => {
    setSlots((prev) => [
      ...prev,
      {
        dayOfWeek: day,
        courseName: '',
        room: '',
        classStartTime: '08:30',
        classEndTime: '10:00',
        campusName: 'FAST-NUCES Chiniot-Faisalabad Campus',
      },
    ]);
  };

  const updateSlotAtIndex = (
    index: number,
    field: 'courseName' | 'room' | 'classStartTime' | 'classEndTime',
    val: string
  ) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const removeSlotAtIndex = (index: number) => {
    setSlots((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await apiFetch('/api/timetable', {
        method: 'PUT',
        body: JSON.stringify({
          slots,
          uploadedFileName: fileName || null,
          uploadedFileType: fileType || null,
        }),
      });
      await refreshAll();
      setSavedMsg('All daily classes saved to your profile and ride matches updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save timetable.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <form
        onSubmit={handleSave}
        className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
      >
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Drop Your Timetable, Skip the Guesswork
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Add your classes manually or upload your timetable (PDF, JPG, PNG, CSV, TXT). We pull every slot and line up rides around your timings.
          </p>
        </div>

        {/* File Upload with AI Auto-Parsing */}
        <label className="flex items-center justify-between gap-4 border border-dashed border-slate-300 rounded-xl p-4 cursor-pointer hover:border-teal-700 transition-colors bg-slate-50/60">
          <div className="flex items-center gap-3 min-w-0">
            {parsing ? (
              <Sparkles className="h-5 w-5 text-teal-700 animate-pulse shrink-0" />
            ) : (
              <Upload className="h-5 w-5 text-teal-700 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {parsing
                  ? `Reading ${fileName} & pulling your classes...`
                  : fileName || 'Upload timetable (PDF, JPG, PNG, WEBP, CSV, TXT)'}
              </div>
              <div className="text-xs text-slate-500">
                Reads course slots and class timings across the whole week.
              </div>
            </div>
          </div>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.txt"
            disabled={parsing}
            onChange={handleFilePick}
            className="hidden"
          />
          <span className="text-xs font-medium text-teal-700 shrink-0">
            {parsing ? 'Analyzing...' : 'Upload & Auto-Fill'}
          </span>
        </label>

        {/* Multi-class Daily Schedule Editor */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">
              Weekly Class Schedule ({slots.length} class{slots.length === 1 ? '' : 'es'})
            </div>
          </div>

          {DAYS.map((day) => {
            const dayEntries = slots
              .map((slot, idx) => ({ slot, idx }))
              .filter(({ slot }) => slot.dayOfWeek === day);

            const win = getDayClassWindow(
              dayEntries.map((d) => d.slot),
              null
            );

            return (
              <div
                key={day}
                className="rounded-xl border border-slate-200 p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 w-9">{day}</span>
                    {dayEntries.length > 0 && win.firstClassTime && win.lastClassTime ? (
                      <span className="text-[11px] font-mono tabular-nums text-slate-500">
                        Classes {win.firstClassTime} – {win.lastClassTime} ({dayEntries.length} class{dayEntries.length > 1 ? 'es' : ''})
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Chill day / no classes</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addClassForDay(day)}
                    className="min-h-[36px] px-2.5 rounded-lg bg-teal-50 text-teal-800 text-xs font-medium hover:bg-teal-100 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Class</span>
                  </button>
                </div>

                {dayEntries.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {dayEntries.map(({ slot, idx }) => (
                      <div
                        key={`${day}-${idx}`}
                        className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 bg-slate-50 rounded-lg p-2"
                      >
                        <input
                          type="text"
                          value={slot.courseName || ''}
                          onChange={(e) =>
                            updateSlotAtIndex(idx, 'courseName', e.target.value)
                          }
                          placeholder="Course (e.g. Data Structures)"
                          className="sm:col-span-5 min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                        />
                        <input
                          type="time"
                          value={slot.classStartTime}
                          onChange={(e) =>
                            updateSlotAtIndex(idx, 'classStartTime', e.target.value)
                          }
                          aria-label={`${day} class start`}
                          className="sm:col-span-2 min-h-[38px] rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-mono tabular-nums"
                        />
                        <input
                          type="time"
                          value={slot.classEndTime}
                          onChange={(e) =>
                            updateSlotAtIndex(idx, 'classEndTime', e.target.value)
                          }
                          aria-label={`${day} class end`}
                          className="sm:col-span-2 min-h-[38px] rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-mono tabular-nums"
                        />
                        <input
                          type="text"
                          value={slot.room || ''}
                          onChange={(e) => updateSlotAtIndex(idx, 'room', e.target.value)}
                          placeholder="Room"
                          className="sm:col-span-2 min-h-[38px] rounded-lg border border-slate-200 bg-white px-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => removeSlotAtIndex(idx)}
                          aria-label="Remove class"
                          className="sm:col-span-1 min-h-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-white cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {savedMsg && (
          <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-xl p-3">
            {savedMsg}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving || parsing}
          className="w-full min-h-[44px] rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {!firebaseUser
            ? 'Sign in to Save Timetable'
            : saving
            ? 'Saving...'
            : 'Save Timetable & Recalculate Matches'}
        </button>
      </form>

      {/* Ranked Compatible Rides */}
      <aside className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 h-fit">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-teal-700" />
          <h3 className="text-sm font-semibold text-slate-900">
            Best Vibe Ride Matches
          </h3>
        </div>
        <p className="text-xs text-slate-500">
          Auto-synced with your earliest lecture and last dismissal each day.
        </p>

        <div className="divide-y divide-slate-100">
          {rankedMatches.slice(0, 6).map(({ ride, dayWindow, match }) => (
            <div key={ride.id} className="py-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  {ride.originCity} → {ride.destinationCity}
                </div>
                <span className="font-mono tabular-nums text-xs font-semibold text-teal-700">
                  {match.totalScore}% vibe match
                </span>
              </div>
              <div className="text-xs text-slate-600 font-mono tabular-nums">
                {ride.travelDate} · Departs {ride.departureTime} · PKR {ride.costSplit.currentPerPerson}
              </div>
              {dayWindow.firstClassTime && (
                <div className="text-[11px] text-slate-500 font-mono">
                  {dayWindow.dayLabel || 'Schedule'} {dayWindow.firstClassTime} – {dayWindow.lastClassTime}
                </div>
              )}
              {match.reasons.length > 0 && (
                <p className="text-xs text-slate-500">{match.reasons.join(' · ')}</p>
              )}
              <button
                type="button"
                onClick={() => onSelectRide(ride)}
                className="mt-1 text-xs font-medium text-teal-700 hover:underline cursor-pointer"
              >
                Scope &amp; Lock Seat →
              </button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
};
