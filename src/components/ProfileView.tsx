import React, { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Camera,
  CreditCard,
  IdCard,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';

async function compressImageToDataUrl(
  file: File,
  maxSize = 256,
  quality = 0.85
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

function docStatusBadge(status?: string) {
  switch (status) {
    case 'verified':
      return {
        label: 'Verified',
        cls: 'bg-teal-50 text-teal-800 border-teal-200',
      };
    case 'pending':
      return {
        label: 'Under Review',
        cls: 'bg-amber-50 text-amber-900 border-amber-200',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        cls: 'bg-red-50 text-red-800 border-red-200',
      };
    default:
      return {
        label: 'Not Uploaded',
        cls: 'bg-slate-100 text-slate-600 border-slate-200',
      };
  }
}

export const ProfileView: React.FC = () => {
  const { firebaseUser, profile, signInWithGoogle, logout, apiFetch, refreshAll } =
    useAuth();

  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [nuEmail, setNuEmail] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('Computer Science');
  const [semester, setSemester] = useState('5th Semester');
  const [homeArea, setHomeArea] = useState('');
  const [preferredDeparture, setPreferredDeparture] = useState('07:30');
  const [preferredReturn, setPreferredReturn] = useState('15:30');
  const [studentIdNote, setStudentIdNote] = useState('');
  const [isDriver, setIsDriver] = useState(false);
  const [isCoordinator, setIsCoordinator] = useState(false);

  // Student ID Card verification state (required for hopping on shared rides)
  const [cardImageUrl, setCardImageUrl] = useState<string | null>(null);
  const [verifyingCard, setVerifyingCard] = useState(false);
  const [cardMsg, setCardMsg] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  // Driver CNIC verification state (required for offering rides)
  const [cnicNumber, setCnicNumber] = useState('');
  const [cnicImageUrl, setCnicImageUrl] = useState<string | null>(null);
  const [verifyingCnic, setVerifyingCnic] = useState(false);
  const [cnicMsg, setCnicMsg] = useState<string | null>(null);
  const [cnicError, setCnicError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName || '');
      setAvatarUrl(profile.avatarUrl || null);
      setNuEmail(profile.nuEmail || '');
      setRollNumber(profile.rollNumber || '');
      setPhone(profile.phone || '');
      setDepartment(profile.department || 'Computer Science');
      setSemester(profile.semester || '5th Semester');
      setHomeArea(profile.homeArea || '');
      setPreferredDeparture(profile.preferredDeparture || '07:30');
      setPreferredReturn(profile.preferredReturn || '15:30');
      setStudentIdNote(profile.studentIdNote || '');
      setIsDriver(profile.isDriver);
      setIsCoordinator(profile.isCoordinator);
      setCardImageUrl(profile.studentCardImageUrl || null);
      setCnicNumber(profile.cnicNumber || '');
      setCnicImageUrl(profile.cnicImageUrl || null);
    }
  }, [profile]);

  if (!firebaseUser) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
        <h2 className="text-xl font-bold text-slate-900 font-display">
          Student Profile &amp; Verification Hub
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with Google to save your FAST-NUCES Student Card (for carpooling &amp; booking rides) and CNIC (manually verified by Admin for offering rides).
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

  const handlePfpChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMsg(null);
    try {
      const compressed = await compressImageToDataUrl(file, 256, 0.85);
      setAvatarUrl(compressed);
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ avatarUrl: compressed }),
      });
      await refreshAll();
      setMsg('Profile photo updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload profile photo.');
    }
  };

  const handleRemovePfp = async () => {
    setError(null);
    setMsg(null);
    try {
      setAvatarUrl(null);
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ avatarUrl: null }),
      });
      await refreshAll();
      setMsg('Profile photo removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove profile photo.');
    }
  };

  const handleStudentCardPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCardError(null);
    setCardMsg(null);
    try {
      const compressed = await compressImageToDataUrl(file, 800, 0.88);
      setCardImageUrl(compressed);
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : 'Could not read Student Card image.'
      );
    }
  };

  const handleVerifyStudentCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setCardError(null);
    setCardMsg(null);
    if (!rollNumber.trim()) {
      setCardError('Enter your FAST-NUCES Roll Number (e.g., 23F-3418) first.');
      return;
    }
    if (!cardImageUrl) {
      setCardError('Upload a clear front photo of your FAST Student ID Card.');
      return;
    }
    setVerifyingCard(true);
    try {
      const res = await apiFetch<{ status: string; note: string }>(
        '/api/verification/student-card',
        {
          method: 'POST',
          body: JSON.stringify({
            rollNumber: rollNumber.trim().toUpperCase(),
            cardImageUrl,
          }),
        }
      );
      await refreshAll();
      if (res.status === 'rejected') {
        setCardError(res.note);
      } else {
        setCardMsg(res.note);
      }
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : 'Unable to submit Student Card.'
      );
    } finally {
      setVerifyingCard(false);
    }
  };

  const handleCnicPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCnicError(null);
    setCnicMsg(null);
    try {
      const compressed = await compressImageToDataUrl(file, 800, 0.88);
      setCnicImageUrl(compressed);
    } catch (err) {
      setCnicError(err instanceof Error ? err.message : 'Could not read CNIC photo.');
    }
  };

  const handleVerifyCnic = async (e: React.FormEvent) => {
    e.preventDefault();
    setCnicError(null);
    setCnicMsg(null);
    const digits = cnicNumber.replace(/\D/g, '');
    if (digits.length !== 13) {
      setCnicError('Enter all 13 digits of your Pakistani CNIC (XXXXX-XXXXXXX-X).');
      return;
    }
    if (!cnicImageUrl) {
      setCnicError('Upload a clear front photo of your CNIC card.');
      return;
    }
    setVerifyingCnic(true);
    try {
      const res = await apiFetch<{ status: string; note: string }>(
        '/api/verification/cnic',
        {
          method: 'POST',
          body: JSON.stringify({
            cnicNumber,
            cnicImageUrl,
          }),
        }
      );
      await refreshAll();
      if (res.status === 'rejected') {
        setCnicError(res.note);
      } else {
        setCnicMsg(res.note);
      }
    } catch (err) {
      setCnicError(err instanceof Error ? err.message : 'Unable to submit CNIC.');
    } finally {
      setVerifyingCnic(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName,
          avatarUrl,
          nuEmail,
          rollNumber,
          phone,
          department,
          semester,
          homeArea,
          preferredDeparture,
          preferredReturn,
          studentIdNote,
          isDriver,
          isCoordinator,
        }),
      });
      await refreshAll();
      setMsg('Profile and FAST-NUCES preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const cardBadge = docStatusBadge(profile?.studentCardStatus);
  const cnicBadge = docStatusBadge(profile?.cnicVerificationStatus);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Status Banner + Profile Picture */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={fullName || profile?.fullName} avatarUrl={avatarUrl} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-base font-semibold text-slate-900">
              <span>{profile?.fullName}</span>
              {profile?.verificationStatus === 'verified' ? (
                <ShieldCheck className="h-4 w-4 text-teal-700 shrink-0" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
              )}
              {profile?.studentCardStatus === 'verified' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                  FAST ID Verified
                </span>
              )}
              {profile?.cnicVerificationStatus === 'verified' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200">
                  Driver CNIC Verified
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 capitalize">
              {profile?.verificationStatus || 'pending'} Student · Rating{' '}
              <span className="font-mono tabular-nums">
                {profile?.ratingAvg || '5.00'}
              </span>{' '}
              ({profile?.ratingCount || 0} reviews) · Cancellations:{' '}
              <span className="font-mono tabular-nums">
                {profile?.cancellationCount || 0}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <label className="min-h-[36px] px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
                <Camera className="h-3.5 w-3.5 text-teal-700" />
                <span>{avatarUrl ? 'Swap PFP' : 'Drop a PFP'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handlePfpChange}
                  className="hidden"
                />
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemovePfp}
                  className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs text-slate-500 hover:text-red-600 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
        >
          Sign Out
        </button>
      </div>

      {/* Document Verification Hub: Student Card (Passengers) + CNIC (Drivers) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. FAST Student Card Verification */}
        <form
          onSubmit={handleVerifyStudentCard}
          className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-teal-700 shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    FAST Student ID Card
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Saves to DB · Verified for carpooling &amp; getting rides only
                  </p>
                </div>
              </div>
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md border ${cardBadge.cls}`}
              >
                {cardBadge.label}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Roll Number
              </label>
              <input
                type="text"
                required
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                placeholder="23F-3418"
                className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-sm font-mono uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Student Card Front Photo
              </label>
              <label className="flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer">
                <Upload className="h-4 w-4 text-teal-700" />
                <span>
                  {cardImageUrl ? 'Replace Student Card Photo' : 'Upload Student Card Photo'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleStudentCardPick}
                  className="hidden"
                />
              </label>
              {cardImageUrl && (
                <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                  <img
                    src={cardImageUrl}
                    alt="Uploaded FAST Student Card preview"
                    className="w-full h-36 object-contain"
                  />
                </div>
              )}
            </div>

            {profile?.verificationReviewNote && (
              <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                {profile.verificationReviewNote}
              </p>
            )}
            {cardMsg && (
              <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-xl p-2.5">
                {cardMsg}
              </p>
            )}
            {cardError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">
                {cardError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={verifyingCard}
            className="w-full min-h-[44px] rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {verifyingCard
              ? 'Saving Student Card...'
              : profile?.studentCardStatus === 'verified'
              ? 'Update Student Card'
              : 'Save & Verify Student Card (Passenger Only)'}
          </button>
        </form>

        {/* 2. Driver CNIC Verification */}
        <form
          onSubmit={handleVerifyCnic}
          className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <IdCard className="h-5 w-5 text-teal-700 shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Driver CNIC Verification
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Saved to DB · Manual Admin verification required to offer rides
                  </p>
                </div>
              </div>
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md border ${cnicBadge.cls}`}
              >
                {cnicBadge.label}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                13-Digit CNIC Number
              </label>
              <div className="relative">
                <CreditCard className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={cnicNumber}
                  onChange={(e) => setCnicNumber(formatCnicInput(e.target.value))}
                  placeholder="33100-1234567-1"
                  maxLength={15}
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 pl-9 pr-3 text-sm font-mono tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                CNIC Front Photo
              </label>
              <label className="flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer">
                <Upload className="h-4 w-4 text-teal-700" />
                <span>
                  {cnicImageUrl ? 'Replace CNIC Front Photo' : 'Upload CNIC Front Photo'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleCnicPick}
                  className="hidden"
                />
              </label>
              {cnicImageUrl && (
                <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                  <img
                    src={cnicImageUrl}
                    alt="Uploaded CNIC card front preview"
                    className="w-full h-36 object-contain"
                  />
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              Saved securely in our database for safety &amp; risk audits. Campus Admin manually verifies your CNIC before you can offer rides or approve vehicles/carries.
            </p>

            {cnicMsg && (
              <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-xl p-2.5">
                {cnicMsg}
              </p>
            )}
            {cnicError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">
                {cnicError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={verifyingCnic}
            className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {verifyingCnic
              ? 'Saving CNIC to DB...'
              : profile?.cnicVerificationStatus === 'verified'
              ? 'Update Driver CNIC'
              : 'Submit CNIC for Admin Review'}
          </button>
        </form>
      </div>

      {/* General Profile Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
      >
        <h3 className="text-base font-semibold text-slate-900">
          FAST-NUCES Flex &amp; Commute Setup
        </h3>
        <p className="text-xs text-slate-500">
          Drop your <span className="font-mono">@cfd.nu.edu.pk</span> or{' '}
          <span className="font-mono">@nu.edu.pk</span> email alongside your Student ID Card and CNIC above.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              FAST-NUCES Email
            </label>
            <input
              type="email"
              value={nuEmail}
              onChange={(e) => setNuEmail(e.target.value)}
              placeholder="f233418@cfd.nu.edu.pk"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Roll Number
            </label>
            <input
              type="text"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="23F-3418"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Phone (Private — shared only after booking confirmation)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+92 300 0000000"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option>Computer Science</option>
              <option>Software Engineering</option>
              <option>Artificial Intelligence</option>
              <option>Data Science</option>
              <option>Electrical Engineering</option>
              <option>Management Sciences</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {[
                '1st Semester',
                '2nd Semester',
                '3rd Semester',
                '4th Semester',
                '5th Semester',
                '6th Semester',
                '7th Semester',
                '8th Semester',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Home Locality / Pickup Area
            </label>
            <input
              type="text"
              value={homeArea}
              onChange={(e) => setHomeArea(e.target.value)}
              placeholder="e.g., Peoples Colony No. 1, Faisalabad"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Pref. Departure
              </label>
              <input
                type="time"
                value={preferredDeparture}
                onChange={(e) => setPreferredDeparture(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Pref. Return
              </label>
              <input
                type="time"
                value={preferredReturn}
                onChange={(e) => setPreferredReturn(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-2 text-sm font-mono tabular-nums"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Student ID Reference / Verification Note
          </label>
          <input
            type="text"
            value={studentIdNote}
            onChange={(e) => setStudentIdNote(e.target.value)}
            placeholder="e.g., FAST Chiniot Card #23F-3418 valid Fall 2026"
            className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-6 pt-2 border-t border-slate-100">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isDriver}
              onChange={(e) => setIsDriver(e.target.checked)}
              className="h-4 w-4 accent-teal-700 rounded"
            />
            <span>Vehicle Owner / Driver</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isCoordinator}
              onChange={(e) => setIsCoordinator(e.target.checked)}
              className="h-4 w-4 accent-teal-700 rounded"
            />
            <span>Carry / Transport Coordinator</span>
          </label>
        </div>

        {msg && (
          <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-xl p-3">
            {msg}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] px-6 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Profile Preferences'}
        </button>
      </form>
    </div>
  );
};
