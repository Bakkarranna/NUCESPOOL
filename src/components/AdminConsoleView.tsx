import React, { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Check,
  Eye,
  FileCheck2,
  IdCard,
  Plus,
  Shield,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  RouteItem,
  TransportServiceItem,
  UserProfile,
  VehicleItem,
  VerificationRecordItem,
} from '../types';

interface AdminData {
  stats: {
    totalStudents: number;
    verifiedStudents: number;
    pendingVerifications: number;
    registeredVehicles: number;
    registeredServices: number;
    activeRides: number;
    confirmedBookings: number;
    openReports: number;
  };
  users: UserProfile[];
  vehicles: VehicleItem[];
  transportServices: TransportServiceItem[];
  verificationRecords?: VerificationRecordItem[];
  rides: {
    id: number;
    originCity: string;
    destinationCity: string;
    travelDate: string;
    departureTime: string;
    availableSeats: number;
    totalSeatsOffered: number;
    status: string;
  }[];
  reports: {
    id: number;
    category: string;
    description: string;
    status: string;
    adminNotes: string | null;
    createdAt: string;
  }[];
  routes: RouteItem[];
  auditLogs: {
    id: number;
    action: string;
    targetType: string;
    details: string;
    createdAt: string;
  }[];
}

export const AdminConsoleView: React.FC = () => {
  const { profile, apiFetch, refreshAll } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<
    'students' | 'transport' | 'rides' | 'reports' | 'routes' | 'records' | 'audit'
  >('students');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newOrigin, setNewOrigin] = useState('');
  const [newDest, setNewDest] = useState('');
  const [newDist, setNewDist] = useState(45);

  const [inspectingUser, setInspectingUser] = useState<UserProfile | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const [inspectingTransport, setInspectingTransport] = useState<
    | { kind: 'vehicle'; item: VehicleItem }
    | { kind: 'service'; item: TransportServiceItem }
    | null
  >(null);
  const [transportReviewNote, setTransportReviewNote] = useState('');
  const [inspectingRecord, setInspectingRecord] = useState<VerificationRecordItem | null>(
    null
  );

  const loadAdmin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<AdminData>('/api/admin/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (profile?.isAdmin) {
      loadAdmin();
    }
  }, [profile?.isAdmin, loadAdmin]);

  useEffect(() => {
    if (!inspectingUser && !inspectingTransport && !inspectingRecord) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inspectingRecord) {
          setInspectingRecord(null);
        } else if (inspectingTransport) {
          setInspectingTransport(null);
        } else if (inspectingUser) {
          setInspectingUser(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectingUser, inspectingTransport, inspectingRecord]);

  if (!profile?.isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-lg mx-auto">
        <Shield className="h-6 w-6 text-slate-400 mx-auto" />
        <h2 className="mt-2 text-lg font-bold text-slate-900">Administrator Access Only</h2>
        <p className="mt-1 text-sm text-slate-500">
          This workspace is restricted to verified NUCESPOOL campus administrators.
        </p>
      </div>
    );
  }

  const updateUserStatus = async (
    id: number,
    verificationStatus: 'verified' | 'rejected' | 'suspended'
  ) => {
    await apiFetch(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ verificationStatus }),
    });
    await Promise.all([loadAdmin(), refreshAll()]);
  };

  const reviewUserDocument = async (
    userId: number,
    payload: {
      cnicVerificationStatus?: 'verified' | 'rejected';
      studentCardStatus?: 'verified' | 'rejected';
      verificationReviewNote?: string;
    }
  ) => {
    setReviewBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>(
        `/api/admin/users/${userId}/documents`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );
      if (inspectingUser && inspectingUser.id === userId) {
        setInspectingUser(res.user);
      }
      await Promise.all([loadAdmin(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review documents.');
    } finally {
      setReviewBusy(false);
    }
  };

  const toggleAdminRole = async (id: number, makeAdmin: boolean) => {
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${id}/admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isAdmin: makeAdmin }),
      });
      await Promise.all([loadAdmin(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update admin role.');
    }
  };

  const updateVehicleStatus = async (
    id: number,
    verificationStatus: 'verified' | 'rejected',
    options?: { alsoVerifyOwnerCnic?: boolean; reviewNote?: string }
  ) => {
    setReviewBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/vehicles/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          verificationStatus,
          alsoVerifyOwnerCnic: options?.alsoVerifyOwnerCnic ?? false,
          reviewNote: options?.reviewNote || undefined,
        }),
      });
      setInspectingTransport(null);
      await Promise.all([loadAdmin(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update vehicle status.');
    } finally {
      setReviewBusy(false);
    }
  };

  const updateServiceStatus = async (
    id: number,
    verificationStatus: 'verified' | 'rejected',
    options?: { alsoVerifyOwnerCnic?: boolean; reviewNote?: string }
  ) => {
    setReviewBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/services/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          verificationStatus,
          alsoVerifyOwnerCnic: options?.alsoVerifyOwnerCnic ?? false,
          reviewNote: options?.reviewNote || undefined,
        }),
      });
      setInspectingTransport(null);
      await Promise.all([loadAdmin(), refreshAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update carry service status.');
    } finally {
      setReviewBusy(false);
    }
  };

  const updateReportStatus = async (id: number, status: 'investigating' | 'resolved' | 'dismissed') => {
    await apiFetch(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadAdmin();
  };

  const handleAddRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrigin.trim() || !newDest.trim()) return;
    await apiFetch('/api/admin/routes', {
      method: 'POST',
      body: JSON.stringify({
        originCity: newOrigin,
        destinationCity: newDest,
        distanceKm: newDist,
      }),
    });
    setNewOrigin('');
    setNewDest('');
    await Promise.all([loadAdmin(), refreshAll()]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Campus Operations &amp; Moderation Console
          </h2>
          <p className="text-sm text-slate-500">
            FAST-NUCES Chiniot verification, fleet checks, safety reports, and route expansion.
            {profile.isSuperAdmin && ' · Primary Owner Portal (Admin Delegation Enabled)'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['Total Students', data.stats.totalStudents],
            ['Verified Students', data.stats.verifiedStudents],
            ['Pending Verifications', data.stats.pendingVerifications],
            ['Vehicles & Carries', data.stats.registeredVehicles + data.stats.registeredServices],
            ['Active Rides', data.stats.activeRides],
            ['Confirmed Bookings', data.stats.confirmedBookings],
            ['Open Reports', data.stats.openReports],
            ['Active Corridors', data.routes.length],
          ].map(([label, val]) => (
            <div
              key={String(label)}
              className="bg-white border border-slate-200 rounded-xl p-4"
            >
              <div className="text-xs text-slate-500">{String(label)}</div>
              <div className="mt-1 font-mono tabular-nums text-2xl font-bold text-slate-900">
                {val}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {[
          ['students', 'Students'],
          ['transport', 'Vehicles & Carries'],
          ['records', 'Document Records'],
          ['rides', 'Rides'],
          ['reports', 'Reports'],
          ['routes', 'Routes & Expansion'],
          ['audit', 'Audit Log'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k as typeof tab)}
            className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              tab === k
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-sm text-slate-500">
          Loading campus records...
        </div>
      ) : data && tab === 'students' ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50">
                <th className="py-3 px-4 font-medium">Student</th>
                <th className="py-3 px-4 font-medium">Roll / NU Email</th>
                <th className="py-3 px-4 font-medium">Documents (ID Card &amp; CNIC)</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Role</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.users.map((u) => {
                const normalizedEmail = u.email.toLowerCase().trim();
                const isOwnerRow =
                  normalizedEmail === 'bakarrkhann@gmail.com' ||
                  normalizedEmail === 'haider.hamid3050@gmail.com';
                const hasDocs = Boolean(u.cnicImageUrl || u.studentCardImageUrl);
                return (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{u.fullName}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700">
                      <div>{u.rollNumber || '—'} · {u.nuEmail || '—'}</div>
                      <div className="text-[11px] text-slate-400">{u.department || '—'}</div>
                    </td>
                    <td className="py-3 px-4 text-xs space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${
                            u.studentCardStatus === 'verified'
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : u.studentCardStatus === 'pending'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : u.studentCardStatus === 'rejected'
                              ? 'bg-red-50 text-red-800 border-red-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          ID: {u.studentCardStatus || 'unsubmitted'}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${
                            u.cnicVerificationStatus === 'verified'
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : u.cnicVerificationStatus === 'pending'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : u.cnicVerificationStatus === 'rejected'
                              ? 'bg-red-50 text-red-800 border-red-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          CNIC: {u.cnicVerificationStatus || 'unsubmitted'}
                        </span>
                      </div>
                      {u.cnicNumber && (
                        <div className="font-mono text-[11px] text-slate-500">
                          {u.cnicNumber}
                        </div>
                      )}
                      {hasDocs && (
                        <button
                          type="button"
                          onClick={() => {
                            setInspectingUser(u);
                            setReviewNote(u.verificationReviewNote || '');
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          View Uploaded Docs
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold uppercase text-slate-800">
                      {u.verificationStatus}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                      {isOwnerRow ? 'Owner (Super Admin)' : u.isAdmin ? 'Admin' : 'Student'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      {u.verificationStatus !== 'verified' && (
                        <button
                          type="button"
                          onClick={() => updateUserStatus(u.id, 'verified')}
                          className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer"
                        >
                          Verify
                        </button>
                      )}
                      {u.verificationStatus !== 'suspended' && !u.isAdmin && (
                        <button
                          type="button"
                          onClick={() => updateUserStatus(u.id, 'suspended')}
                          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 cursor-pointer"
                        >
                          Suspend
                        </button>
                      )}
                      {profile.isSuperAdmin && !isOwnerRow && (
                        <button
                          type="button"
                          onClick={() => toggleAdminRole(u.id, !u.isAdmin)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                            u.isAdmin
                              ? 'border border-amber-300 text-amber-800 hover:bg-amber-50'
                              : 'bg-slate-900 text-white hover:bg-slate-800'
                          }`}
                        >
                          {u.isAdmin ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : data && tab === 'transport' ? (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
              Personal Vehicles (Manual CNIC Verification)
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Vehicle</th>
                  <th className="py-2.5 px-4 font-medium">Plate</th>
                  <th className="py-2.5 px-4 font-medium">Driver</th>
                  <th className="py-2.5 px-4 font-medium">CNIC Attached</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.vehicles.map((v) => (
                  <tr key={v.id}>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      <div>{v.makeModel} ({v.category})</div>
                      {v.reviewNote && (
                        <div className="text-[11px] font-normal text-slate-500">
                          {v.reviewNote}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700">
                      {v.registrationNumber}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {v.driverName} ({v.driverPhone})
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-mono text-slate-700">
                        {v.cnicNumber || 'No CNIC'}
                      </div>
                      {v.cnicImageUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setInspectingTransport({ kind: 'vehicle', item: v });
                            setTransportReviewNote(v.reviewNote || '');
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline cursor-pointer mt-0.5"
                        >
                          <Eye className="h-3 w-3" />
                          View CNIC
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold uppercase">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] ${
                          v.verificationStatus === 'verified'
                            ? 'bg-teal-50 text-teal-800 border-teal-200'
                            : v.verificationStatus === 'rejected'
                            ? 'bg-red-50 text-red-800 border-red-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {v.verificationStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() =>
                          updateVehicleStatus(v.id, 'verified', { alsoVerifyOwnerCnic: true })
                        }
                        className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5 inline" /> Verify + CNIC
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => updateVehicleStatus(v.id, 'rejected')}
                        className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 cursor-pointer disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5 inline" /> Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
              Coordinated Carry &amp; Transport Services (Manual CNIC Verification)
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Carry Service</th>
                  <th className="py-2.5 px-4 font-medium">Plate</th>
                  <th className="py-2.5 px-4 font-medium">Driver</th>
                  <th className="py-2.5 px-4 font-medium">CNIC Attached</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.transportServices.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      <div>{s.serviceName} ({s.vehicleModel})</div>
                      {s.reviewNote && (
                        <div className="text-[11px] font-normal text-slate-500">
                          {s.reviewNote}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{s.registrationNumber}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {s.driverName} ({s.driverPhone})
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-mono text-slate-700">
                        {s.cnicNumber || 'No CNIC'}
                      </div>
                      {s.cnicImageUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setInspectingTransport({ kind: 'service', item: s });
                            setTransportReviewNote(s.reviewNote || '');
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline cursor-pointer mt-0.5"
                        >
                          <Eye className="h-3 w-3" />
                          View CNIC
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold uppercase">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] ${
                          s.verificationStatus === 'verified'
                            ? 'bg-teal-50 text-teal-800 border-teal-200'
                            : s.verificationStatus === 'rejected'
                            ? 'bg-red-50 text-red-800 border-red-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {s.verificationStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() =>
                          updateServiceStatus(s.id, 'verified', { alsoVerifyOwnerCnic: true })
                        }
                        className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer disabled:opacity-50"
                      >
                        Verify + CNIC
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => updateServiceStatus(s.id, 'rejected')}
                        className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 cursor-pointer disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : data && tab === 'records' ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <FileCheck2 className="h-4 w-4 text-teal-700" />
              Permanent Document &amp; Risk Audit Records ({data.verificationRecords?.length || 0})
            </span>
            <span className="text-[11px] text-slate-500">
              All Student Card, CNIC, Vehicle &amp; Carry uploads preserved in Cloud SQL
            </span>
          </div>
          {!data.verificationRecords || data.verificationRecords.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No verification submissions recorded yet.</p>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-50 bg-slate-50">
                  <th className="py-3 px-4 font-medium">Student</th>
                  <th className="py-3 px-4 font-medium">Document Type</th>
                  <th className="py-3 px-4 font-medium">Reference #</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Reviewer / Note</th>
                  <th className="py-3 px-4 font-medium">Uploaded</th>
                  <th className="py-3 px-4 font-medium text-right">Image</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.verificationRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">
                        {rec.userName || `User #${rec.userId}`}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {rec.rollNumber || rec.userEmail || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-800">
                      {rec.documentType.replace(/_/g, ' ').toUpperCase()}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700">
                      {rec.referenceNumber || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold uppercase">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] ${
                          rec.status === 'verified'
                            ? 'bg-teal-50 text-teal-800 border-teal-200'
                            : rec.status === 'rejected'
                            ? 'bg-red-50 text-red-800 border-red-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {rec.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                      {rec.reviewerName && (
                        <div className="font-semibold text-slate-800">
                          Reviewed by {rec.reviewerName}
                        </div>
                      )}
                      <div className="truncate">{rec.reviewNote || '—'}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(rec.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {rec.documentImageUrl ? (
                        <button
                          type="button"
                          onClick={() => setInspectingRecord(rec)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-teal-700 hover:bg-teal-50 cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Inspect Image
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">No Image</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : data && tab === 'rides' ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50">
                <th className="py-3 px-4 font-medium">Corridor</th>
                <th className="py-3 px-4 font-medium">Date &amp; Time</th>
                <th className="py-3 px-4 font-medium">Seats Open</th>
                <th className="py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rides.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {r.originCity} → {r.destinationCity}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700">
                    {r.travelDate} · {r.departureTime}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs">
                    {r.availableSeats} / {r.totalSeatsOffered}
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold uppercase text-slate-700">
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data && tab === 'reports' ? (
        <div className="space-y-3">
          {data.reports.map((rep) => (
            <div
              key={rep.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  Report #{rep.id} · {rep.category}
                </div>
                <p className="text-xs text-slate-600">{rep.description}</p>
                <div className="text-xs text-slate-500 uppercase font-semibold">
                  Status: {rep.status}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateReportStatus(rep.id, 'investigating')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium cursor-pointer"
                >
                  Investigate
                </button>
                <button
                  type="button"
                  onClick={() => updateReportStatus(rep.id, 'resolved')}
                  className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium cursor-pointer"
                >
                  Resolve
                </button>
                <button
                  type="button"
                  onClick={() => updateReportStatus(rep.id, 'dismissed')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : data && tab === 'routes' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Active Campus Corridors</h3>
            <div className="divide-y divide-slate-100">
              {data.routes.map((r) => (
                <div key={r.id} className="py-3 flex justify-between text-sm">
                  <span className="font-medium text-slate-900">{r.corridorLabel}</span>
                  <span className="font-mono tabular-nums text-xs text-slate-500">
                    {r.distanceKm} km
                  </span>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleAddRoute}
            className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 h-fit"
          >
            <h3 className="text-sm font-semibold text-slate-900">
              Add New Corridor (Multi-Campus Expansion)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={newOrigin}
                onChange={(e) => setNewOrigin(e.target.value)}
                placeholder="Origin City (e.g., Sargodha)"
                className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
              <input
                type="text"
                required
                value={newDest}
                onChange={(e) => setNewDest(e.target.value)}
                placeholder="Destination City (e.g., Chiniot)"
                className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
            <input
              type="number"
              min={1}
              value={newDist}
              onChange={(e) => setNewDist(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono"
            />
            <button
              type="submit"
              className="min-h-[44px] px-4 rounded-xl bg-teal-700 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add Corridor</span>
            </button>
          </form>
        </div>
      ) : data && tab === 'audit' ? (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {data.auditLogs.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No administrative actions logged yet.</p>
          ) : (
            data.auditLogs.map((log) => (
              <div key={log.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                <div>
                  <span className="font-mono font-semibold text-slate-900">{log.action}</span>
                  <span className="text-slate-600"> — {log.details}</span>
                </div>
                <span className="font-mono tabular-nums text-slate-400 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* Document Inspection Modal */}
      {inspectingUser && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingUser(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-5 cursor-default"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 font-display">
                  Document Check · {inspectingUser.fullName}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Roll: {inspectingUser.rollNumber || 'N/A'} · CNIC: {inspectingUser.cnicNumber || 'N/A'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingUser(null)}
                aria-label="Close document inspection"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Student ID Card Panel */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <BadgeCheck className="h-4 w-4 text-teal-700" />
                    Student ID Card
                  </span>
                  <span className="text-[11px] font-semibold uppercase text-slate-700">
                    {inspectingUser.studentCardStatus}
                  </span>
                </div>
                {inspectingUser.studentCardImageUrl ? (
                  <img
                    src={inspectingUser.studentCardImageUrl}
                    alt="FAST Student ID Card"
                    className="w-full h-44 object-contain rounded-lg bg-white border border-slate-200"
                  />
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                    No Student Card uploaded
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() =>
                      reviewUserDocument(inspectingUser.id, {
                        studentCardStatus: 'verified',
                        verificationReviewNote: reviewNote,
                      })
                    }
                    className="flex-1 min-h-[38px] rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer disabled:opacity-50"
                  >
                    Approve ID
                  </button>
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() =>
                      reviewUserDocument(inspectingUser.id, {
                        studentCardStatus: 'rejected',
                        verificationReviewNote: reviewNote,
                      })
                    }
                    className="flex-1 min-h-[38px] rounded-lg border border-red-200 bg-white text-red-700 text-xs font-medium hover:bg-red-50 cursor-pointer disabled:opacity-50"
                  >
                    Reject ID
                  </button>
                </div>
              </div>

              {/* Driver CNIC Panel */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <IdCard className="h-4 w-4 text-teal-700" />
                    Driver CNIC
                  </span>
                  <span className="text-[11px] font-semibold uppercase text-slate-700">
                    {inspectingUser.cnicVerificationStatus}
                  </span>
                </div>
                {inspectingUser.cnicImageUrl ? (
                  <img
                    src={inspectingUser.cnicImageUrl}
                    alt="Driver CNIC Card"
                    className="w-full h-44 object-contain rounded-lg bg-white border border-slate-200"
                  />
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                    No CNIC uploaded
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() =>
                      reviewUserDocument(inspectingUser.id, {
                        cnicVerificationStatus: 'verified',
                        verificationReviewNote: reviewNote,
                      })
                    }
                    className="flex-1 min-h-[38px] rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer disabled:opacity-50"
                  >
                    Approve CNIC
                  </button>
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() =>
                      reviewUserDocument(inspectingUser.id, {
                        cnicVerificationStatus: 'rejected',
                        verificationReviewNote: reviewNote,
                      })
                    }
                    className="flex-1 min-h-[38px] rounded-lg border border-red-200 bg-white text-red-700 text-xs font-medium hover:bg-red-50 cursor-pointer disabled:opacity-50"
                  >
                    Reject CNIC
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Review Note for Student (optional)
              </label>
              <input
                type="text"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="e.g., Clear FAST Card & CNIC verified for Fall 2026"
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Vehicle / Carry CNIC Inspection Modal */}
      {inspectingTransport && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingTransport(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-5 cursor-default"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 font-display">
                  {inspectingTransport.kind === 'vehicle'
                    ? `Vehicle & CNIC Review · ${inspectingTransport.item.makeModel}`
                    : `Carry & CNIC Review · ${inspectingTransport.item.serviceName}`}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Plate: {inspectingTransport.item.registrationNumber} · CNIC:{' '}
                  {inspectingTransport.item.cnicNumber || 'N/A'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingTransport(null)}
                aria-label="Close transport inspection"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-xs text-slate-700">
                <span className="font-semibold">Driver:</span>{' '}
                {inspectingTransport.item.driverName} ({inspectingTransport.item.driverPhone})
              </div>
              {inspectingTransport.kind === 'service' && (
                <div className="text-xs text-slate-600">
                  <span className="font-semibold">Authorization Note:</span>{' '}
                  {inspectingTransport.item.authorizationNote}
                </div>
              )}
              {inspectingTransport.item.cnicImageUrl ? (
                <img
                  src={inspectingTransport.item.cnicImageUrl}
                  alt="Driver CNIC submitted with transport"
                  className="w-full h-56 object-contain rounded-lg bg-white border border-slate-200 mt-2"
                />
              ) : (
                <div className="h-40 flex items-center justify-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                  No CNIC image attached
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Admin Review Note (saved to database audit trail)
              </label>
              <input
                type="text"
                value={transportReviewNote}
                onChange={(e) => setTransportReviewNote(e.target.value)}
                placeholder="e.g., CNIC matches registration owner and clear photo"
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={reviewBusy}
                onClick={() =>
                  inspectingTransport.kind === 'vehicle'
                    ? updateVehicleStatus(inspectingTransport.item.id, 'verified', {
                        alsoVerifyOwnerCnic: true,
                        reviewNote: transportReviewNote,
                      })
                    : updateServiceStatus(inspectingTransport.item.id, 'verified', {
                        alsoVerifyOwnerCnic: true,
                        reviewNote: transportReviewNote,
                      })
                }
                className="flex-1 min-h-[42px] px-3 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 cursor-pointer disabled:opacity-50"
              >
                Approve &amp; Verify Driver CNIC
              </button>
              <button
                type="button"
                disabled={reviewBusy}
                onClick={() =>
                  inspectingTransport.kind === 'vehicle'
                    ? updateVehicleStatus(inspectingTransport.item.id, 'verified', {
                        alsoVerifyOwnerCnic: false,
                        reviewNote: transportReviewNote,
                      })
                    : updateServiceStatus(inspectingTransport.item.id, 'verified', {
                        alsoVerifyOwnerCnic: false,
                        reviewNote: transportReviewNote,
                      })
                }
                className="min-h-[42px] px-3 rounded-xl border border-teal-300 text-teal-800 text-xs font-semibold hover:bg-teal-50 cursor-pointer disabled:opacity-50"
              >
                Approve Only
              </button>
              <button
                type="button"
                disabled={reviewBusy}
                onClick={() =>
                  inspectingTransport.kind === 'vehicle'
                    ? updateVehicleStatus(inspectingTransport.item.id, 'rejected', {
                        alsoVerifyOwnerCnic: true,
                        reviewNote: transportReviewNote,
                      })
                    : updateServiceStatus(inspectingTransport.item.id, 'rejected', {
                        alsoVerifyOwnerCnic: true,
                        reviewNote: transportReviewNote,
                      })
                }
                className="min-h-[42px] px-4 rounded-xl border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50 cursor-pointer disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Verification Record Image Modal */}
      {inspectingRecord && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingRecord(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4 cursor-default"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-display">
                  {inspectingRecord.documentType.replace(/_/g, ' ').toUpperCase()} ·{' '}
                  {inspectingRecord.userName || `User #${inspectingRecord.userId}`}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Ref: {inspectingRecord.referenceNumber || 'N/A'} · Status:{' '}
                  {inspectingRecord.status.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingRecord(null)}
                aria-label="Close document image"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {inspectingRecord.documentImageUrl && (
              <img
                src={inspectingRecord.documentImageUrl}
                alt="Stored verification document"
                className="w-full max-h-80 object-contain rounded-xl bg-slate-50 border border-slate-200"
              />
            )}

            {inspectingRecord.reviewNote && (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                {inspectingRecord.reviewNote}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
