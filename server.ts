import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.ts';
import {
  auditLogs,
  bookings,
  liveLocations,
  messageReactions,
  messages,
  notifications,
  reports,
  reviews,
  rideChallans,
  rideSchedules,
  rides,
  routes,
  timetableSlots,
  transportServices,
  users,
  vehicles,
  verificationRecords,
} from './src/db/schema.ts';
import { getOrCreateUser, isSuperAdminEmail } from './src/db/users.ts';
import {
  createBookingTransactional,
  decideBookingTransactional,
  getAdminOverview,
  getPublicCatalog,
  getUserWorkspace,
} from './src/db/queries.ts';
import { AuthRequest, requireAuth } from './src/middleware/auth.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALLOWED_EMOJIS = new Set(['👍', '✅', '📍', '🙏', '🚗']);

function generateDatesForWeekdays(weekdaysCsv: string, daysAhead = 14): string[] {
  const allowed = new Set(
    weekdaysCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayName = DAY_NAMES[d.getDay()];
    if (allowed.has(dayName)) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

function normalizeTimeHHMM(raw: string | undefined | null, fallback = '08:30'): string {
  if (!raw) return fallback;
  const cleaned = String(raw).trim().toUpperCase();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (!match) return fallback;
  let hours = Number(match[1]);
  const mins = Number(match[2]);
  const ampm = match[3];
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function normalizeDayName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('mon')) return 'Mon';
  if (s.startsWith('tue')) return 'Tue';
  if (s.startsWith('wed')) return 'Wed';
  if (s.startsWith('thu')) return 'Thu';
  if (s.startsWith('fri')) return 'Fri';
  if (s.startsWith('sat')) return 'Sat';
  return null;
}

function validateAvatarUrl(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('data:image/')) {
    if (trimmed.length > 900_000) {
      throw new Error('Profile photo must be smaller than 650 KB.');
    }
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)) {
      throw new Error('Unsupported profile photo image format.');
    }
    return trimmed;
  }
  if (trimmed.startsWith('https://')) {
    return trimmed.slice(0, 1000);
  }
  throw new Error('Profile photo must be a valid image upload or HTTPS URL.');
}

function validateDocumentImageUrl(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`${label} photo is required.`);
  }
  const trimmed = raw.trim();
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(trimmed)) {
    throw new Error(`${label} must be uploaded as a PNG, JPG, or WEBP image.`);
  }
  if (trimmed.length > 950_000) {
    throw new Error(`${label} photo is too large (max ~700 KB after compression).`);
  }
  return trimmed;
}

function normalizeCnic(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 13) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function parseDataUrlParts(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return { mimeType: 'image/jpeg', data: dataUrl };
  }
  return {
    mimeType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
    data: match[2],
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/public/maps-config', (_req, res) => {
    res.json({
      apiKey:
        process.env.VITE_GOOGLE_MAPS_API_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        '',
    });
  });

  // Public ride discovery (sanitized, zero PII)
  app.get('/api/public/catalog', async (_req, res) => {
    try {
      const catalog = await getPublicCatalog();
      res.json(catalog);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load catalog';
      res.status(500).json({ error: msg });
    }
  });

  // Authenticated session + workspace sync
  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@nucespool.local`;
      const fullName = req.user!.name || null;

      const user = await getOrCreateUser({ uid, email, fullName });
      const workspace = await getUserWorkspace(user.id);
      res.json({ user, workspace });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to sync session';
      res.status(500).json({ error: msg });
    }
  });

  // Update student profile, PFP & verification submission
  app.put('/api/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const current = await getOrCreateUser({
        uid,
        email: req.user!.email || '',
        fullName: req.user!.name || null,
      });

      const {
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
      } = req.body;

      let validatedAvatar: string | null | undefined;
      try {
        validatedAvatar = validateAvatarUrl(avatarUrl);
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid profile image.',
        });
      }

      const normalizedNu =
        typeof nuEmail === 'string' ? nuEmail.trim().toLowerCase() : current.nuEmail;
      const qualifiesAutoVerify =
        current.isAdmin ||
        current.verificationStatus === 'verified' ||
        (normalizedNu &&
          (normalizedNu.endsWith('@nu.edu.pk') ||
            normalizedNu.endsWith('@cfd.nu.edu.pk')));

      const nextStatus =
        current.verificationStatus === 'suspended'
          ? 'suspended'
          : qualifiesAutoVerify
          ? 'verified'
          : 'pending';

      const [updated] = await db
        .update(users)
        .set({
          fullName:
            typeof fullName === 'string' && fullName.trim()
              ? fullName.trim()
              : current.fullName,
          avatarUrl:
            validatedAvatar !== undefined ? validatedAvatar : current.avatarUrl,
          nuEmail: normalizedNu || null,
          rollNumber:
            typeof rollNumber === 'string'
              ? rollNumber.trim().toUpperCase()
              : current.rollNumber,
          phone: typeof phone === 'string' ? phone.trim() : current.phone,
          department:
            typeof department === 'string' ? department.trim() : current.department,
          semester:
            typeof semester === 'string' ? semester.trim() : current.semester,
          homeArea:
            typeof homeArea === 'string' ? homeArea.trim() : current.homeArea,
          preferredDeparture:
            typeof preferredDeparture === 'string'
              ? preferredDeparture
              : current.preferredDeparture,
          preferredReturn:
            typeof preferredReturn === 'string'
              ? preferredReturn
              : current.preferredReturn,
          studentIdNote:
            typeof studentIdNote === 'string'
              ? studentIdNote.trim()
              : current.studentIdNote,
          isDriver: typeof isDriver === 'boolean' ? isDriver : current.isDriver,
          isCoordinator:
            typeof isCoordinator === 'boolean'
              ? isCoordinator
              : current.isCoordinator,
          verificationStatus: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, current.id))
        .returning();

      res.json({
        user: { ...updated, isSuperAdmin: current.isSuperAdmin },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update profile';
      res.status(500).json({ error: msg });
    }
  });

  // Upload & save FAST-NUCES Student ID Card (verifies profile for carpooling & booking rides ONLY)
  app.post('/api/verification/student-card', requireAuth, async (req: AuthRequest, res) => {
    try {
      const current = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
        fullName: req.user!.name || null,
      });

      const cleanRoll = String(req.body?.rollNumber || current.rollNumber || '')
        .trim()
        .toUpperCase();
      if (cleanRoll.length < 3) {
        return res.status(400).json({
          error:
            'Enter your FAST-NUCES Roll Number (e.g., 23F-3418) alongside your Student Card photo.',
        });
      }

      let validCardImage: string;
      try {
        validCardImage = validateDocumentImageUrl(
          req.body?.cardImageUrl,
          'Student ID Card'
        );
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid Student ID Card image.',
        });
      }

      const reviewNote =
        'Student ID Card saved to database. Profile verified for carpooling & booking shared rides (offering rides still requires manual Admin CNIC verification).';

      const nextAccountStatus =
        current.verificationStatus === 'suspended' ? 'suspended' : 'verified';

      const [updated] = await db
        .update(users)
        .set({
          rollNumber: cleanRoll,
          studentCardImageUrl: validCardImage,
          studentCardStatus: 'verified',
          verificationStatus: nextAccountStatus,
          verificationReviewNote: reviewNote,
          updatedAt: new Date(),
        })
        .where(eq(users.id, current.id))
        .returning();

      await db.insert(verificationRecords).values({
        userId: current.id,
        documentType: 'student_card',
        referenceNumber: cleanRoll,
        documentImageUrl: validCardImage,
        status: 'verified',
        reviewNote,
        reviewedAt: new Date(),
      });

      await db.insert(notifications).values({
        userId: current.id,
        type: 'document_verification',
        title: 'Student ID Card Saved & Verified (Passenger Access)',
        body: reviewNote,
      });

      res.json({
        user: { ...updated, isSuperAdmin: current.isSuperAdmin },
        status: 'verified',
        note: reviewNote,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to save Student ID Card.';
      res.status(500).json({ error: msg });
    }
  });

  // Upload Pakistani CNIC (saved to database — ALWAYS requires manual Admin verification)
  app.post('/api/verification/cnic', requireAuth, async (req: AuthRequest, res) => {
    try {
      const current = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
        fullName: req.user!.name || null,
      });

      const formattedCnic = normalizeCnic(req.body?.cnicNumber);
      if (!formattedCnic) {
        return res.status(400).json({
          error: 'Enter a valid 13-digit Pakistani CNIC number (XXXXX-XXXXXXX-X).',
        });
      }

      let validCnicImage: string;
      try {
        validCnicImage = validateDocumentImageUrl(
          req.body?.cnicImageUrl,
          'CNIC Front'
        );
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid CNIC image.',
        });
      }

      const nextCnicStatus = 'pending';
      const reviewNote =
        'CNIC number & photo saved to database. Awaiting manual verification by Campus Admin before offering rides.';

      const [updated] = await db
        .update(users)
        .set({
          cnicNumber: formattedCnic,
          cnicImageUrl: validCnicImage,
          cnicVerificationStatus: nextCnicStatus,
          verificationReviewNote: reviewNote,
          updatedAt: new Date(),
        })
        .where(eq(users.id, current.id))
        .returning();

      await db.insert(verificationRecords).values({
        userId: current.id,
        documentType: 'cnic_driver',
        referenceNumber: formattedCnic,
        documentImageUrl: validCnicImage,
        status: 'pending',
        reviewNote,
      });

      await db.insert(notifications).values({
        userId: current.id,
        type: 'document_verification',
        title: 'CNIC Uploaded — Pending Manual Admin Verification',
        body: reviewNote,
      });

      res.json({
        user: { ...updated, isSuperAdmin: current.isSuperAdmin },
        status: nextCnicStatus,
        note: reviewNote,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to upload CNIC.';
      res.status(500).json({ error: msg });
    }
  });

  // Register personal vehicle (with CNIC image saved to DB for manual Admin verification)
  app.post('/api/vehicles', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (user.verificationStatus === 'suspended') {
        return res.status(403).json({ error: 'Suspended accounts cannot register vehicles.' });
      }

      const {
        category,
        makeModel,
        registrationNumber,
        color,
        capacity,
        driverName,
        driverPhone,
        isSelfDriven,
        cnicNumber,
        cnicImageUrl,
      } = req.body;

      if (!makeModel || !registrationNumber || !driverName || !driverPhone) {
        return res.status(400).json({ error: 'All vehicle and driver fields are required.' });
      }

      const formattedInputCnic = cnicNumber ? normalizeCnic(cnicNumber) : null;
      if (cnicNumber && !formattedInputCnic) {
        return res.status(400).json({
          error: 'Enter a valid 13-digit CNIC number (XXXXX-XXXXXXX-X).',
        });
      }

      let resolvedCnicImage: string | null = null;
      if (cnicImageUrl) {
        try {
          resolvedCnicImage = validateDocumentImageUrl(cnicImageUrl, 'CNIC Front');
        } catch (err) {
          return res.status(400).json({
            error: err instanceof Error ? err.message : 'Invalid CNIC image.',
          });
        }
      }

      const finalCnicNumber = formattedInputCnic || user.cnicNumber;
      const finalCnicImage = resolvedCnicImage || user.cnicImageUrl;

      if (!user.isAdmin && (!finalCnicNumber || !finalCnicImage)) {
        return res.status(400).json({
          error:
            'Please provide your 13-digit CNIC number and upload your CNIC image to add a vehicle.',
        });
      }

      const regPlate = String(registrationNumber).trim().toUpperCase();
      const [vehicle] = await db
        .insert(vehicles)
        .values({
          ownerUserId: user.id,
          category: category === 'motorcycle' ? 'motorcycle' : 'car',
          makeModel: String(makeModel).trim(),
          registrationNumber: regPlate,
          color: String(color || 'White').trim(),
          capacity: Math.max(1, Math.min(8, Number(capacity) || 3)),
          driverName: String(driverName).trim(),
          driverPhone: String(driverPhone).trim(),
          isSelfDriven: Boolean(isSelfDriven),
          cnicNumber: finalCnicNumber,
          cnicImageUrl: finalCnicImage,
          verificationStatus: 'pending',
        })
        .returning();

      const cnicChangedOrNew =
        Boolean(resolvedCnicImage && resolvedCnicImage !== user.cnicImageUrl) ||
        Boolean(formattedInputCnic && formattedInputCnic !== user.cnicNumber);
      const nextCnicStatus =
        user.cnicVerificationStatus === 'verified' && !cnicChangedOrNew
          ? 'verified'
          : 'pending';

      await db
        .update(users)
        .set({
          isDriver: true,
          cnicNumber: finalCnicNumber || user.cnicNumber,
          cnicImageUrl: finalCnicImage || user.cnicImageUrl,
          cnicVerificationStatus: nextCnicStatus,
          verificationReviewNote:
            nextCnicStatus === 'pending'
              ? `Vehicle ${regPlate} & CNIC saved to database. Awaiting manual Admin verification.`
              : user.verificationReviewNote,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await db.insert(verificationRecords).values({
        userId: user.id,
        documentType: 'vehicle_registration',
        referenceNumber: `${regPlate} · CNIC ${finalCnicNumber || 'N/A'}`,
        documentImageUrl: finalCnicImage,
        status: 'pending',
        relatedVehicleId: vehicle.id,
        reviewNote: `Submitted personal vehicle ${String(makeModel).trim()} (${regPlate}) with CNIC for manual Admin review.`,
      });

      if (cnicChangedOrNew && finalCnicNumber && finalCnicImage) {
        await db.insert(verificationRecords).values({
          userId: user.id,
          documentType: 'cnic_driver',
          referenceNumber: finalCnicNumber,
          documentImageUrl: finalCnicImage,
          status: 'pending',
          relatedVehicleId: vehicle.id,
          reviewNote: `CNIC uploaded during vehicle registration (${regPlate}).`,
        });
      }

      await db.insert(notifications).values({
        userId: user.id,
        type: 'document_verification',
        title: 'Vehicle & CNIC Saved for Admin Review',
        body: `Your vehicle (${regPlate}) and CNIC image are saved in our database and awaiting manual Campus Admin verification.`,
      });

      res.status(201).json({ vehicle });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to register vehicle';
      res.status(500).json({ error: msg });
    }
  });

  // Register existing transport service / carry (with CNIC image saved to DB for manual Admin verification)
  app.post('/api/transport-services', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (user.verificationStatus === 'suspended') {
        return res
          .status(403)
          .json({ error: 'Suspended accounts cannot register transport services.' });
      }

      const {
        serviceName,
        serviceType,
        vehicleModel,
        registrationNumber,
        capacity,
        driverName,
        driverPhone,
        authorizationNote,
        cnicNumber,
        cnicImageUrl,
      } = req.body;

      if (
        !serviceName ||
        !vehicleModel ||
        !registrationNumber ||
        !driverName ||
        !driverPhone ||
        !authorizationNote
      ) {
        return res.status(400).json({
          error: 'All transport service and authorization fields are required.',
        });
      }

      const formattedInputCnic = cnicNumber ? normalizeCnic(cnicNumber) : null;
      if (cnicNumber && !formattedInputCnic) {
        return res.status(400).json({
          error: 'Enter a valid 13-digit CNIC number (XXXXX-XXXXXXX-X).',
        });
      }

      let resolvedCnicImage: string | null = null;
      if (cnicImageUrl) {
        try {
          resolvedCnicImage = validateDocumentImageUrl(cnicImageUrl, 'CNIC Front');
        } catch (err) {
          return res.status(400).json({
            error: err instanceof Error ? err.message : 'Invalid CNIC image.',
          });
        }
      }

      const finalCnicNumber = formattedInputCnic || user.cnicNumber;
      const finalCnicImage = resolvedCnicImage || user.cnicImageUrl;

      if (!user.isAdmin && (!finalCnicNumber || !finalCnicImage)) {
        return res.status(400).json({
          error:
            'Please provide your 13-digit CNIC number and upload your CNIC image to add a carry service.',
        });
      }

      const regPlate = String(registrationNumber).trim().toUpperCase();
      const [service] = await db
        .insert(transportServices)
        .values({
          coordinatorUserId: user.id,
          serviceName: String(serviceName).trim(),
          serviceType: ['carry', 'van', 'private_driver'].includes(serviceType)
            ? serviceType
            : 'carry',
          vehicleModel: String(vehicleModel).trim(),
          registrationNumber: regPlate,
          capacity: Math.max(1, Math.min(18, Number(capacity) || 6)),
          driverName: String(driverName).trim(),
          driverPhone: String(driverPhone).trim(),
          authorizationNote: String(authorizationNote).trim(),
          cnicNumber: finalCnicNumber,
          cnicImageUrl: finalCnicImage,
          verificationStatus: 'pending',
        })
        .returning();

      const cnicChangedOrNew =
        Boolean(resolvedCnicImage && resolvedCnicImage !== user.cnicImageUrl) ||
        Boolean(formattedInputCnic && formattedInputCnic !== user.cnicNumber);
      const nextCnicStatus =
        user.cnicVerificationStatus === 'verified' && !cnicChangedOrNew
          ? 'verified'
          : 'pending';

      await db
        .update(users)
        .set({
          isCoordinator: true,
          cnicNumber: finalCnicNumber || user.cnicNumber,
          cnicImageUrl: finalCnicImage || user.cnicImageUrl,
          cnicVerificationStatus: nextCnicStatus,
          verificationReviewNote:
            nextCnicStatus === 'pending'
              ? `Carry service ${String(serviceName).trim()} & CNIC saved to database. Awaiting manual Admin verification.`
              : user.verificationReviewNote,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await db.insert(verificationRecords).values({
        userId: user.id,
        documentType: 'carry_service',
        referenceNumber: `${regPlate} · CNIC ${finalCnicNumber || 'N/A'}`,
        documentImageUrl: finalCnicImage,
        status: 'pending',
        relatedServiceId: service.id,
        reviewNote: `Submitted carry service "${String(serviceName).trim()}" (${regPlate}) with CNIC for manual Admin review.`,
      });

      if (cnicChangedOrNew && finalCnicNumber && finalCnicImage) {
        await db.insert(verificationRecords).values({
          userId: user.id,
          documentType: 'cnic_driver',
          referenceNumber: finalCnicNumber,
          documentImageUrl: finalCnicImage,
          status: 'pending',
          relatedServiceId: service.id,
          reviewNote: `CNIC uploaded during carry service registration (${regPlate}).`,
        });
      }

      await db.insert(notifications).values({
        userId: user.id,
        type: 'document_verification',
        title: 'Carry Service & CNIC Saved for Admin Review',
        body: `Your carry service (${String(serviceName).trim()}) and CNIC image are saved in our database and awaiting manual Campus Admin verification.`,
      });

      res.status(201).json({ service });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to register transport service';
      res.status(500).json({ error: msg });
    }
  });

  // Publish one-time or recurring ride
  app.post('/api/rides', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (
        !user.isAdmin &&
        (user.cnicVerificationStatus !== 'verified' || user.studentCardStatus !== 'verified')
      ) {
        return res.status(403).json({
          error:
            'Driver CNIC verification and FAST Student ID Card verification are both required in Profile before offering rides.',
        });
      }

      const {
        routeId,
        vehicleId,
        transportServiceId,
        originArea,
        destinationArea,
        pickupPoints,
        travelDate,
        departureTime,
        returnTime,
        journeyType,
        isRecurring,
        weekdays,
        offeredSeats,
        estimatedTotalCost,
        costMethod,
        includeDriverInSplit,
        challanSplitEnabled,
        notes,
      } = req.body;

      const [route] = await db
        .select()
        .from(routes)
        .where(eq(routes.id, Number(routeId)))
        .limit(1);

      if (!route) {
        return res.status(400).json({ error: 'Selected route does not exist.' });
      }

      if (!vehicleId && !transportServiceId) {
        return res
          .status(400)
          .json({ error: 'Select a registered vehicle or transport service.' });
      }

      if (vehicleId && !user.isAdmin) {
        const [veh] = await db
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.id, Number(vehicleId)), eq(vehicles.ownerUserId, user.id)))
          .limit(1);
        if (!veh) {
          return res.status(404).json({ error: 'Selected vehicle was not found on your account.' });
        }
        if (veh.verificationStatus !== 'verified') {
          return res.status(403).json({
            error:
              'Your vehicle is still awaiting manual Campus Admin verification before publishing rides.',
          });
        }
      }

      if (transportServiceId && !user.isAdmin) {
        const [srv] = await db
          .select()
          .from(transportServices)
          .where(
            and(
              eq(transportServices.id, Number(transportServiceId)),
              eq(transportServices.coordinatorUserId, user.id)
            )
          )
          .limit(1);
        if (!srv) {
          return res
            .status(404)
            .json({ error: 'Selected transport service was not found on your account.' });
        }
        if (srv.verificationStatus !== 'verified') {
          return res.status(403).json({
            error:
              'Your carry service is still awaiting manual Campus Admin verification before publishing rides.',
          });
        }
      }

      const seatsNum = Math.max(1, Math.min(16, Number(offeredSeats) || 1));
      const costNum = Math.max(50, Number(estimatedTotalCost) || 1000);
      const safeCostMethod =
        costMethod === 'fixed_per_seat' ? 'fixed_per_seat' : 'equal_split';
      const safeJourney = ['morning', 'evening', 'round_trip'].includes(journeyType)
        ? journeyType
        : 'morning';

      let scheduleId: number | null = null;
      let targetDates: string[] = [];

      if (isRecurring && weekdays) {
        const [schedule] = await db
          .insert(rideSchedules)
          .values({
            providerUserId: user.id,
            routeId: route.id,
            vehicleId: vehicleId ? Number(vehicleId) : null,
            transportServiceId: transportServiceId
              ? Number(transportServiceId)
              : null,
            originArea: String(originArea || route.originCity).trim(),
            destinationArea: String(destinationArea || route.destinationCity).trim(),
            pickupPoints: String(pickupPoints || route.originCity).trim(),
            departureTime: String(departureTime || '07:30'),
            returnTime: returnTime ? String(returnTime) : null,
            journeyType: safeJourney,
            weekdays: String(weekdays),
            offeredSeats: seatsNum,
            estimatedTotalCost: costNum,
            costMethod: safeCostMethod,
            includeDriverInSplit: Boolean(includeDriverInSplit),
            challanSplitEnabled: challanSplitEnabled !== false,
            notes: notes ? String(notes).trim() : null,
          })
          .returning();
        scheduleId = schedule.id;
        targetDates = generateDatesForWeekdays(String(weekdays), 14);
        if (targetDates.length === 0) {
          targetDates = [new Date().toISOString().slice(0, 10)];
        }
      } else {
        targetDates = [
          typeof travelDate === 'string' && travelDate.length === 10
            ? travelDate
            : new Date().toISOString().slice(0, 10),
        ];
      }

      const createdRides = await db
        .insert(rides)
        .values(
          targetDates.map((d) => ({
            scheduleId,
            providerUserId: user.id,
            routeId: route.id,
            vehicleId: vehicleId ? Number(vehicleId) : null,
            transportServiceId: transportServiceId
              ? Number(transportServiceId)
              : null,
            originCity: route.originCity,
            originArea: String(originArea || route.originCity).trim(),
            destinationCity: route.destinationCity,
            destinationArea: String(destinationArea || route.destinationCity).trim(),
            pickupPoints: String(pickupPoints || route.originCity).trim(),
            travelDate: d,
            departureTime: String(departureTime || '07:30'),
            returnTime: returnTime ? String(returnTime) : null,
            journeyType: safeJourney,
            totalSeatsOffered: seatsNum,
            availableSeats: seatsNum,
            estimatedTotalCost: costNum,
            costMethod: safeCostMethod,
            includeDriverInSplit: Boolean(includeDriverInSplit),
            challanSplitEnabled: challanSplitEnabled !== false,
            notes: notes ? String(notes).trim() : null,
            status: 'scheduled',
          }))
        )
        .returning();

      res.status(201).json({ rides: createdRides, scheduleId });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to publish ride';
      res.status(500).json({ error: msg });
    }
  });

  // Update ride status (complete / cancel)
  app.patch('/api/rides/:id/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const rideId = Number(req.params.id);
      const { status, departureTime } = req.body;

      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });
      if (ride.providerUserId !== user.id && !user.isAdmin) {
        return res.status(403).json({ error: 'Not authorized to modify this ride.' });
      }

      const nextStatus = ['scheduled', 'completed', 'cancelled'].includes(status)
        ? status
        : ride.status;
      const nextDeparture =
        typeof departureTime === 'string' && departureTime
          ? departureTime
          : ride.departureTime;

      const [updated] = await db
        .update(rides)
        .set({ status: nextStatus, departureTime: nextDeparture })
        .where(eq(rides.id, rideId))
        .returning();

      const affectedBookings = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, rideId),
            inArray(bookings.status, ['pending', 'accepted'])
          )
        );

      if (nextStatus === 'completed') {
        await db
          .update(bookings)
          .set({ status: 'completed', cashConfirmed: true, updatedAt: new Date() })
          .where(and(eq(bookings.rideId, rideId), eq(bookings.status, 'accepted')));
      } else if (nextStatus === 'cancelled') {
        await db
          .update(bookings)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(bookings.rideId, rideId),
              inArray(bookings.status, ['pending', 'accepted'])
            )
          );
        await db
          .update(liveLocations)
          .set({ isSharing: false, updatedAt: new Date() })
          .where(eq(liveLocations.rideId, rideId));
        await db
          .update(users)
          .set({ cancellationCount: sql`${users.cancellationCount} + 1` })
          .where(eq(users.id, user.id));
      }

      if (affectedBookings.length > 0) {
        await db.insert(notifications).values(
          affectedBookings.map((b) => ({
            userId: b.passengerUserId,
            type: nextStatus === 'cancelled' ? 'ride_cancelled' : 'ride_updated',
            title:
              nextStatus === 'cancelled'
                ? 'Ride cancelled by provider'
                : nextStatus === 'completed'
                ? 'Ride completed — leave a review'
                : 'Ride departure updated',
            body:
              nextStatus === 'cancelled'
                ? `${ride.originCity} → ${ride.destinationCity} on ${ride.travelDate} was cancelled.`
                : nextStatus === 'completed'
                ? `Your ride on ${ride.travelDate} is marked completed.`
                : `Departure time updated to ${nextDeparture} for ${ride.travelDate}.`,
            relatedRideId: rideId,
          }))
        );
      }

      res.json({ ride: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update ride';
      res.status(500).json({ error: msg });
    }
  });

  // Request a seat (transactional)
  app.post('/api/bookings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!user.isAdmin && user.studentCardStatus !== 'verified') {
        return res.status(403).json({
          error:
            'Verify your FAST Student ID Card in Profile before hopping on shared rides.',
        });
      }

      const { rideId, seatsRequested, pickupPoint, passengerNote } = req.body;
      const booking = await createBookingTransactional({
        rideId: Number(rideId),
        passengerUserId: user.id,
        seatsRequested: Math.max(1, Number(seatsRequested) || 1),
        pickupPoint: String(pickupPoint || 'Main Stop').trim(),
        passengerNote: passengerNote ? String(passengerNote).trim() : undefined,
      });

      res.status(201).json({ booking });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : '';
      const map: Record<string, [number, string]> = {
        RIDE_NOT_FOUND: [404, 'Ride not found.'],
        RIDE_NOT_AVAILABLE: [400, 'This ride is no longer accepting bookings.'],
        CANNOT_BOOK_OWN_RIDE: [400, 'You cannot book a seat on your own ride.'],
        INSUFFICIENT_SEATS: [409, 'Not enough available seats remaining.'],
        DUPLICATE_BOOKING: [409, 'You already have an active request for this ride.'],
      };
      if (map[code]) {
        return res.status(map[code][0]).json({ error: map[code][1] });
      }
      res.status(500).json({ error: 'Failed to submit ride request.' });
    }
  });

  // Accept / Reject / Cancel / Complete / No-Show booking (transactional)
  app.patch('/api/bookings/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });

      const action = req.body?.action;
      if (!['accept', 'reject', 'cancel', 'complete', 'no_show'].includes(action)) {
        return res.status(400).json({ error: 'Invalid booking action.' });
      }

      const booking = await decideBookingTransactional({
        bookingId: Number(req.params.id),
        actorUserId: user.id,
        action,
      });

      res.json({ booking });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : '';
      const map: Record<string, [number, string]> = {
        BOOKING_NOT_FOUND: [404, 'Booking not found.'],
        RIDE_NOT_FOUND: [404, 'Ride not found.'],
        FORBIDDEN: [403, 'You are not permitted to perform this action.'],
        INVALID_STATE: [400, 'Booking cannot transition from its current status.'],
        INSUFFICIENT_SEATS: [409, 'Not enough seats remaining to accept this request.'],
      };
      if (map[code]) {
        return res.status(map[code][0]).json({ error: map[code][1] });
      }
      res.status(500).json({ error: 'Failed to process booking action.' });
    }
  });

  // Save multi-class timetable slots & file metadata
  app.put('/api/timetable', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const { slots, uploadedFileName, uploadedFileType } = req.body;
      if (!Array.isArray(slots)) {
        return res.status(400).json({ error: 'Timetable slots array is required.' });
      }

      await db.delete(timetableSlots).where(eq(timetableSlots.userId, user.id));

      const validSlots = slots
        .map((s) => {
          const day = normalizeDayName(s.dayOfWeek);
          if (!day || !s.classStartTime || !s.classEndTime) return null;
          return {
            userId: user.id,
            dayOfWeek: day,
            courseName: s.courseName ? String(s.courseName).trim().slice(0, 120) : null,
            room: s.room ? String(s.room).trim().slice(0, 60) : null,
            classStartTime: normalizeTimeHHMM(String(s.classStartTime), '08:30'),
            classEndTime: normalizeTimeHHMM(String(s.classEndTime), '10:00'),
            campusName: String(
              s.campusName || 'FAST-NUCES Chiniot-Faisalabad Campus'
            ),
            breakPeriod: s.breakPeriod ? String(s.breakPeriod) : null,
            uploadedFileName: uploadedFileName ? String(uploadedFileName) : null,
            uploadedFileType: uploadedFileType ? String(uploadedFileType) : null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const inserted =
        validSlots.length > 0
          ? await db.insert(timetableSlots).values(validSlots).returning()
          : [];

      res.json({ timetable: inserted });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save timetable';
      res.status(500).json({ error: msg });
    }
  });

  // Parse uploaded timetable (PDF, JPG, PNG, WEBP, CSV, TXT) via Gemini & update profile timetable
  app.post('/api/timetable/parse', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });

      const { fileName, mimeType, base64Data, textContent } = req.body;
      if (!fileName || (!base64Data && !textContent)) {
        return res.status(400).json({
          error: 'Please upload a valid timetable file (PDF, JPG, PNG, WEBP, CSV, or TXT).',
        });
      }

      const lowerName = String(fileName).toLowerCase();
      const allowedMime = new Set([
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'text/csv',
        'text/plain',
        'application/vnd.ms-excel',
      ]);
      const allowedExt = /\.(pdf|jpg|jpeg|png|webp|csv|txt)$/i.test(lowerName);
      if (!allowedExt && (!mimeType || !allowedMime.has(String(mimeType).toLowerCase()))) {
        return res.status(400).json({
          error:
            'Unsupported timetable format. Allowed formats: PDF, JPG, PNG, WEBP, CSV, TXT.',
        });
      }

      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({
          error: 'Timetable parser service is not configured yet.',
        });
      }

      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = `Extract every individual university class/lab session from this FAST-NUCES timetable.
Return an array of classes where each item has:
- dayOfWeek: one of "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
- courseName: concise course name or code (e.g. "CS-3001 Data Structures" or "Coal Lab")
- classStartTime: 24-hour HH:mm format (e.g. "08:30", "13:15")
- classEndTime: 24-hour HH:mm format (e.g. "09:50", "16:00")
- room: classroom or lab code if present (or empty string)
Include EVERY individual class across all days, including multiple classes on the same day at different times. Convert 12-hour PM university times (like 1:00 - 4:30) accurately to 24-hour HH:mm (13:00 - 16:30).`;

      const contents: Array<
        string | { inlineData: { mimeType: string; data: string } }
      > = [prompt];

      if (textContent && typeof textContent === 'string') {
        contents.push(`Timetable file (${fileName}):\n${textContent.slice(0, 50_000)}`);
      } else if (base64Data && typeof base64Data === 'string') {
        const cleanBase64 = base64Data.includes(',')
          ? base64Data.split(',')[1]
          : base64Data;
        const resolvedMime =
          mimeType && mimeType !== 'image/jpg'
            ? String(mimeType)
            : lowerName.endsWith('.pdf')
            ? 'application/pdf'
            : lowerName.endsWith('.png')
            ? 'image/png'
            : lowerName.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
        contents.push({
          inlineData: {
            mimeType: resolvedMime,
            data: cleanBase64,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dayOfWeek: { type: Type.STRING },
                courseName: { type: Type.STRING },
                classStartTime: { type: Type.STRING },
                classEndTime: { type: Type.STRING },
                room: { type: Type.STRING },
              },
              required: ['dayOfWeek', 'courseName', 'classStartTime', 'classEndTime'],
            },
          },
        },
      });

      const rawText = response.text || '[]';
      let parsed: Array<{
        dayOfWeek?: string;
        courseName?: string;
        classStartTime?: string;
        classEndTime?: string;
        room?: string;
      }> = [];

      try {
        parsed = JSON.parse(rawText);
      } catch {
        return res.status(422).json({
          error: 'Could not interpret class schedule from the uploaded file. Please try a clearer image, PDF, or CSV.',
        });
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return res.status(422).json({
          error: 'No classes were detected in this timetable file. Verify the file shows days and class times.',
        });
      }

      const validExtracted = parsed
        .map((item) => {
          const day = normalizeDayName(item.dayOfWeek);
          if (!day || !VALID_DAYS.includes(day)) return null;
          return {
            userId: user.id,
            dayOfWeek: day,
            courseName: item.courseName
              ? String(item.courseName).trim().slice(0, 120)
              : 'Scheduled Class',
            room: item.room ? String(item.room).trim().slice(0, 60) : null,
            classStartTime: normalizeTimeHHMM(item.classStartTime, '08:30'),
            classEndTime: normalizeTimeHHMM(item.classEndTime, '10:00'),
            campusName: 'FAST-NUCES Chiniot-Faisalabad Campus',
            breakPeriod: null,
            uploadedFileName: String(fileName).slice(0, 200),
            uploadedFileType: mimeType ? String(mimeType).slice(0, 100) : 'document',
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (validExtracted.length === 0) {
        return res.status(422).json({
          error: 'No valid Mon–Sat class timings could be extracted from the file.',
        });
      }

      await db.delete(timetableSlots).where(eq(timetableSlots.userId, user.id));
      const inserted = await db
        .insert(timetableSlots)
        .values(validExtracted)
        .returning();

      res.json({
        timetable: inserted,
        extractedCount: inserted.length,
      });
    } catch (error: unknown) {
      console.error('Timetable parse error:', error);
      const msg =
        error instanceof Error
          ? error.message
          : 'Failed to analyze timetable document.';
      res.status(500).json({ error: msg });
    }
  });

  // In-app messaging
  app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const { rideId, receiverUserId, content } = req.body;
      if (!rideId || !receiverUserId || !content?.trim()) {
        return res
          .status(400)
          .json({ error: 'Ride, recipient, and message content are required.' });
      }

      const [message] = await db
        .insert(messages)
        .values({
          rideId: Number(rideId),
          senderUserId: user.id,
          receiverUserId: Number(receiverUserId),
          content: String(content).trim().slice(0, 1000),
        })
        .returning();

      await db.insert(notifications).values({
        userId: Number(receiverUserId),
        type: 'new_message',
        title: `Message from ${user.fullName}`,
        body: String(content).trim().slice(0, 120),
        relatedRideId: Number(rideId),
      });

      res.status(201).json({ message });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to send message';
      res.status(500).json({ error: msg });
    }
  });

  // Toggle emoji reaction on a chat message
  app.post('/api/messages/:id/reactions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const messageId = Number(req.params.id);
      const emoji = String(req.body?.emoji || '').trim();

      if (!ALLOWED_EMOJIS.has(emoji)) {
        return res.status(400).json({ error: 'Unsupported reaction emoji.' });
      }

      const [msg] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!msg) return res.status(404).json({ error: 'Message not found.' });

      if (msg.senderUserId !== user.id && msg.receiverUserId !== user.id) {
        return res.status(403).json({ error: 'Not authorized to react to this message.' });
      }

      const existing = await db
        .select()
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.userId, user.id),
            eq(messageReactions.emoji, emoji)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .delete(messageReactions)
          .where(eq(messageReactions.id, existing[0].id));
        return res.json({ toggled: 'removed', emoji });
      }

      await db.insert(messageReactions).values({
        messageId,
        userId: user.id,
        emoji,
      });

      res.status(201).json({ toggled: 'added', emoji });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to toggle reaction';
      res.status(500).json({ error: msg });
    }
  });

  // Real-time location sharing between passenger and driver on a ride
  app.post('/api/rides/:id/location', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const rideId = Number(req.params.id);
      const { lat, lng, note, isSharing } = req.body;

      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const isDriver = ride.providerUserId === user.id;
      const [activeBooking] = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, rideId),
            eq(bookings.passengerUserId, user.id),
            inArray(bookings.status, ['pending', 'accepted'])
          )
        )
        .limit(1);

      if (!isDriver && !activeBooking) {
        return res.status(403).json({
          error: 'Only the driver or passengers on this ride can share live location.',
        });
      }

      const latNum = Number(lat);
      const lngNum = Number(lng);
      const sharingFlag = isSharing !== false;

      if (
        sharingFlag &&
        (Number.isNaN(latNum) ||
          Number.isNaN(lngNum) ||
          latNum < -90 ||
          latNum > 90 ||
          lngNum < -180 ||
          lngNum > 180)
      ) {
        return res.status(400).json({ error: 'Valid GPS coordinates are required.' });
      }

      const existing = await db
        .select()
        .from(liveLocations)
        .where(
          and(eq(liveLocations.rideId, rideId), eq(liveLocations.userId, user.id))
        )
        .limit(1);

      const role = isDriver ? 'driver' : 'passenger';
      if (existing.length > 0) {
        const [updated] = await db
          .update(liveLocations)
          .set({
            role,
            lat: Number.isNaN(latNum) ? existing[0].lat : latNum,
            lng: Number.isNaN(lngNum) ? existing[0].lng : lngNum,
            note: note ? String(note).trim().slice(0, 120) : existing[0].note,
            isSharing: sharingFlag,
            updatedAt: new Date(),
          })
          .where(eq(liveLocations.id, existing[0].id))
          .returning();
        return res.json({ location: updated });
      }

      const [created] = await db
        .insert(liveLocations)
        .values({
          rideId,
          userId: user.id,
          role,
          lat: Number.isNaN(latNum) ? 31.6025 : latNum,
          lng: Number.isNaN(lngNum) ? 73.0358 : lngNum,
          note: note ? String(note).trim().slice(0, 120) : null,
          isSharing: sharingFlag,
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json({ location: created });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update location';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/rides/:id/locations', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const rideId = Number(req.params.id);

      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const isDriver = ride.providerUserId === user.id;
      const [activeBooking] = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, rideId),
            eq(bookings.passengerUserId, user.id),
            inArray(bookings.status, ['pending', 'accepted'])
          )
        )
        .limit(1);

      if (!isDriver && !activeBooking && !user.isAdmin) {
        return res.status(403).json({
          error: 'Only ride participants can view live shared locations.',
        });
      }

      const rows = await db
        .select()
        .from(liveLocations)
        .where(
          and(eq(liveLocations.rideId, rideId), eq(liveLocations.isSharing, true))
        )
        .orderBy(desc(liveLocations.updatedAt));

      const userIds = rows.map((r) => r.userId);
      const userRows =
        userIds.length > 0
          ? await db
              .select({
                id: users.id,
                fullName: users.fullName,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .where(inArray(users.id, userIds))
          : [];
      const uMap = new Map(userRows.map((u) => [u.id, u]));

      const locations = rows.map((r) => ({
        ...r,
        fullName: uMap.get(r.userId)?.fullName ?? 'Student',
        avatarUrl: uMap.get(r.userId)?.avatarUrl ?? null,
      }));

      res.json({ locations });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load locations';
      res.status(500).json({ error: msg });
    }
  });

  // Mark notifications read
  app.post('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, user.id));
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to mark notifications';
      res.status(500).json({ error: msg });
    }
  });

  // Submit review & written comment for a ride (accepted or completed booking)
  app.post('/api/reviews', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });

      const {
        bookingId,
        overallRating,
        punctualityRating,
        communicationRating,
        experienceRating,
        comment,
      } = req.body;

      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, Number(bookingId)))
        .limit(1);

      if (!booking || booking.passengerUserId !== user.id) {
        return res.status(403).json({ error: 'Booking not eligible for review.' });
      }
      if (!['completed', 'accepted'].includes(booking.status)) {
        return res.status(400).json({
          error: 'Only accepted or completed rides can be reviewed.',
        });
      }

      if (booking.status === 'accepted') {
        await db
          .update(bookings)
          .set({ status: 'completed', cashConfirmed: true, updatedAt: new Date() })
          .where(eq(bookings.id, booking.id));
      }

      const [ride] = await db
        .select()
        .from(rides)
        .where(eq(rides.id, booking.rideId))
        .limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const clamp = (v: unknown) =>
        Math.max(1, Math.min(5, Math.round(Number(v)) || 5));
      const overall = clamp(overallRating);
      const cleanComment = comment ? String(comment).trim().slice(0, 600) : null;

      const [review] = await db
        .insert(reviews)
        .values({
          bookingId: booking.id,
          rideId: ride.id,
          reviewerUserId: user.id,
          revieweeUserId: ride.providerUserId,
          overallRating: overall,
          punctualityRating: clamp(punctualityRating),
          communicationRating: clamp(communicationRating),
          experienceRating: clamp(experienceRating),
          comment: cleanComment,
        })
        .returning();

      const allProviderReviews = await db
        .select()
        .from(reviews)
        .where(eq(reviews.revieweeUserId, ride.providerUserId));

      const avg =
        allProviderReviews.reduce((sum, r) => sum + r.overallRating, 0) /
        Math.max(1, allProviderReviews.length);

      await db
        .update(users)
        .set({
          ratingAvg: avg.toFixed(2),
          ratingCount: allProviderReviews.length,
        })
        .where(eq(users.id, ride.providerUserId));

      await db.insert(notifications).values({
        userId: ride.providerUserId,
        type: 'new_review',
        title: `New ${overall}★ Driver Rating from ${user.fullName}`,
        body: cleanComment
          ? `"${cleanComment.slice(0, 120)}"`
          : `Rated ${overall}/5 on your ${ride.originCity} → ${ride.destinationCity} ride.`,
        relatedRideId: ride.id,
      });

      res.status(201).json({ review });
    } catch (error: unknown) {
      const msg =
        error instanceof Error && error.message.includes('unique')
          ? 'You have already reviewed this booking.'
          : 'Failed to submit review.';
      res.status(400).json({ error: msg });
    }
  });

  // Log a traffic challan on a ride and split it equally among everyone in the car
  app.post('/api/rides/:id/challans', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const rideId = Number(req.params.id);
      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const activeBookings = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, rideId),
            inArray(bookings.status, ['accepted', 'completed'])
          )
        );

      const isDriver = ride.providerUserId === user.id;
      const isRidePassenger = activeBookings.some((b) => b.passengerUserId === user.id);

      if (!isDriver && !isRidePassenger && !user.isAdmin) {
        return res.status(403).json({
          error: 'Only the driver or confirmed passengers on this car can log a challan.',
        });
      }

      const rawAmount = Number(req.body?.amount);
      if (!Number.isFinite(rawAmount) || rawAmount < 50 || rawAmount > 100000) {
        return res.status(400).json({
          error: 'Enter a valid traffic challan amount between PKR 50 and PKR 100,000.',
        });
      }

      const title =
        typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim().slice(0, 100)
          : 'Traffic Challan';
      const locationNote =
        typeof req.body?.locationNote === 'string' && req.body.locationNote.trim()
          ? req.body.locationNote.trim().slice(0, 120)
          : null;
      const includeDriverFlag = req.body?.includeDriver !== false;

      const confirmedSeats = activeBookings.reduce(
        (sum, b) => sum + Math.max(1, b.seatsRequested),
        0
      );
      const headcount = Math.max(1, confirmedSeats + (includeDriverFlag ? 1 : 0));
      const amount = Math.round(rawAmount);
      const perPersonShare = Math.round(amount / headcount);

      const [challan] = await db
        .insert(rideChallans)
        .values({
          rideId,
          reportedByUserId: user.id,
          title,
          amount,
          locationNote,
          includeDriver: includeDriverFlag,
          headcount,
          perPersonShare,
          status: 'active',
        })
        .returning();

      const recipientIds = new Set<number>([
        ride.providerUserId,
        ...activeBookings.map((b) => b.passengerUserId),
      ]);
      recipientIds.delete(user.id);

      if (recipientIds.size > 0) {
        await db.insert(notifications).values(
          Array.from(recipientIds).map((uid) => ({
            userId: uid,
            type: 'traffic_challan',
            title: `Traffic Challan Split (${title})`,
            body: `PKR ${amount} challan${locationNote ? ` at ${locationNote}` : ''} split across ${headcount} people in the car = PKR ${perPersonShare} per head.`,
            relatedRideId: rideId,
          }))
        );
      }

      res.status(201).json({ challan });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to log traffic challan.';
      res.status(500).json({ error: msg });
    }
  });

  // Mark a traffic challan as settled / active
  app.patch('/api/challans/:id/settle', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const challanId = Number(req.params.id);
      const [challan] = await db
        .select()
        .from(rideChallans)
        .where(eq(rideChallans.id, challanId))
        .limit(1);
      if (!challan) return res.status(404).json({ error: 'Challan record not found.' });

      const [ride] = await db
        .select()
        .from(rides)
        .where(eq(rides.id, challan.rideId))
        .limit(1);

      if (
        challan.reportedByUserId !== user.id &&
        ride?.providerUserId !== user.id &&
        !user.isAdmin
      ) {
        return res.status(403).json({ error: 'Not authorized to update this challan.' });
      }

      const nextStatus = challan.status === 'settled' ? 'active' : 'settled';
      const [updated] = await db
        .update(rideChallans)
        .set({ status: nextStatus })
        .where(eq(rideChallans.id, challanId))
        .returning();

      res.json({ challan: updated });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to update challan status.';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/challans/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const challanId = Number(req.params.id);
      const [challan] = await db
        .select()
        .from(rideChallans)
        .where(eq(rideChallans.id, challanId))
        .limit(1);
      if (!challan) return res.status(404).json({ error: 'Challan record not found.' });

      const [ride] = await db
        .select()
        .from(rides)
        .where(eq(rides.id, challan.rideId))
        .limit(1);

      if (
        challan.reportedByUserId !== user.id &&
        ride?.providerUserId !== user.id &&
        !user.isAdmin
      ) {
        return res.status(403).json({ error: 'Not authorized to remove this challan.' });
      }

      await db.delete(rideChallans).where(eq(rideChallans.id, challanId));
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to delete challan.';
      res.status(500).json({ error: msg });
    }
  });

  // Safety & misconduct reporting
  app.post('/api/reports', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const { reportedUserId, rideId, category, description } = req.body;
      if (!category || !description?.trim()) {
        return res
          .status(400)
          .json({ error: 'Category and description are required.' });
      }

      const [report] = await db
        .insert(reports)
        .values({
          reporterUserId: user.id,
          reportedUserId: reportedUserId ? Number(reportedUserId) : null,
          rideId: rideId ? Number(rideId) : null,
          category: String(category),
          description: String(description).trim().slice(0, 1000),
          status: 'open',
        })
        .returning();

      res.status(201).json({ report });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to file report';
      res.status(500).json({ error: msg });
    }
  });

  // Admin Console Routes
  app.get('/api/admin/overview', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!user.isAdmin) {
        return res.status(403).json({ error: 'Administrator access required.' });
      }
      const data = await getAdminOverview();
      res.json(data);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to load admin overview';
      res.status(500).json({ error: msg });
    }
  });

  // Super Admin ONLY: Promote or revoke admin privileges
  app.patch('/api/admin/users/:id/admin', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!actor.isSuperAdmin) {
        return res.status(403).json({
          error: 'Only the primary platform owner can grant or revoke admin privileges.',
        });
      }

      const targetId = Number(req.params.id);
      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (isSuperAdminEmail(target.email)) {
        return res
          .status(400)
          .json({ error: 'Primary owner admin role cannot be modified.' });
      }

      const makeAdmin = Boolean(req.body?.isAdmin);
      const [updated] = await db
        .update(users)
        .set({
          isAdmin: makeAdmin,
          verificationStatus: makeAdmin ? 'verified' : target.verificationStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetId))
        .returning();

      await db.insert(auditLogs).values({
        adminUserId: actor.id,
        action: makeAdmin ? 'ADMIN_GRANTED' : 'ADMIN_REVOKED',
        targetType: 'user',
        targetId,
        details: `${makeAdmin ? 'Promoted' : 'Revoked'} admin access for ${updated.fullName} (${updated.email})`,
      });

      await db.insert(notifications).values({
        userId: updated.id,
        type: 'admin_role',
        title: makeAdmin ? 'Admin access granted' : 'Admin access revoked',
        body: makeAdmin
          ? 'The NUCESPOOL owner granted you administrator access to the Moderation Console.'
          : 'Your administrator access on NUCESPOOL was revoked.',
      });

      res.json({ user: updated });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to update admin role';
      res.status(500).json({ error: msg });
    }
  });

  app.patch('/api/admin/users/:id/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) return res.status(403).json({ error: 'Admin access required.' });

      const targetId = Number(req.params.id);
      const { verificationStatus } = req.body;
      if (
        !['pending', 'verified', 'rejected', 'suspended'].includes(verificationStatus)
      ) {
        return res.status(400).json({ error: 'Invalid verification status.' });
      }

      const [updated] = await db
        .update(users)
        .set({ verificationStatus, updatedAt: new Date() })
        .where(eq(users.id, targetId))
        .returning();

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: `USER_${verificationStatus.toUpperCase()}`,
        targetType: 'user',
        targetId,
        details: `Updated student status for ${updated?.fullName ?? targetId} to ${verificationStatus}`,
      });

      if (updated) {
        await db.insert(notifications).values({
          userId: updated.id,
          type: 'verification_update',
          title: `Account status: ${verificationStatus}`,
          body:
            verificationStatus === 'verified'
              ? 'Your FAST-NUCES Chiniot student verification has been approved.'
              : `Your student account verification status was updated to ${verificationStatus}.`,
        });
      }

      res.json({ user: updated });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to update student status';
      res.status(500).json({ error: msg });
    }
  });

  // Admin review of CNIC & Student ID Card documents
  app.patch(
    '/api/admin/users/:id/documents',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const admin = await getOrCreateUser({
          uid: req.user!.uid,
          email: req.user!.email || '',
        });
        if (!admin.isAdmin) {
          return res.status(403).json({ error: 'Admin access required.' });
        }

        const targetId = Number(req.params.id);
        const [target] = await db
          .select()
          .from(users)
          .where(eq(users.id, targetId))
          .limit(1);
        if (!target) {
          return res.status(404).json({ error: 'User not found.' });
        }

        const { cnicVerificationStatus, studentCardStatus, verificationReviewNote } =
          req.body;

        const allowedDocStates = new Set(['pending', 'verified', 'rejected']);
        if (cnicVerificationStatus && !allowedDocStates.has(cnicVerificationStatus)) {
          return res.status(400).json({ error: 'Invalid CNIC verification status.' });
        }
        if (studentCardStatus && !allowedDocStates.has(studentCardStatus)) {
          return res.status(400).json({ error: 'Invalid Student Card status.' });
        }

        const nextCnicStatus =
          cnicVerificationStatus || target.cnicVerificationStatus;
        const nextCardStatus = studentCardStatus || target.studentCardStatus;
        const nextAccountStatus =
          target.verificationStatus === 'suspended'
            ? 'suspended'
            : nextCardStatus === 'verified'
            ? 'verified'
            : target.verificationStatus;

        const [updated] = await db
          .update(users)
          .set({
            cnicVerificationStatus: nextCnicStatus,
            studentCardStatus: nextCardStatus,
            verificationStatus: nextAccountStatus,
            verificationReviewNote:
              typeof verificationReviewNote === 'string' && verificationReviewNote.trim()
                ? verificationReviewNote.trim().slice(0, 300)
                : target.verificationReviewNote,
            updatedAt: new Date(),
          })
          .where(eq(users.id, targetId))
          .returning();

        const summaryParts: string[] = [];
        if (cnicVerificationStatus) summaryParts.push(`CNIC: ${cnicVerificationStatus}`);
        if (studentCardStatus) summaryParts.push(`Student Card: ${studentCardStatus}`);

        await db.insert(auditLogs).values({
          adminUserId: admin.id,
          action: 'DOCUMENTS_REVIEWED',
          targetType: 'user',
          targetId,
          details: `Reviewed documents for ${updated.fullName} (${summaryParts.join(', ')})`,
        });

        if (cnicVerificationStatus) {
          await db
            .update(verificationRecords)
            .set({
              status: cnicVerificationStatus,
              reviewedByAdminId: admin.id,
              reviewedAt: new Date(),
              reviewNote:
                typeof verificationReviewNote === 'string' && verificationReviewNote.trim()
                  ? verificationReviewNote.trim().slice(0, 300)
                  : `Admin marked CNIC ${cnicVerificationStatus}.`,
            })
            .where(
              and(
                eq(verificationRecords.userId, targetId),
                eq(verificationRecords.documentType, 'cnic_driver')
              )
            );
        }
        if (studentCardStatus) {
          await db
            .update(verificationRecords)
            .set({
              status: studentCardStatus,
              reviewedByAdminId: admin.id,
              reviewedAt: new Date(),
              reviewNote:
                typeof verificationReviewNote === 'string' && verificationReviewNote.trim()
                  ? verificationReviewNote.trim().slice(0, 300)
                  : `Admin marked Student Card ${studentCardStatus}.`,
            })
            .where(
              and(
                eq(verificationRecords.userId, targetId),
                eq(verificationRecords.documentType, 'student_card')
              )
            );
        }

        await db.insert(notifications).values({
          userId: updated.id,
          type: 'document_verification',
          title: 'Campus Document Verification Updated',
          body: `Admin review completed (${summaryParts.join(', ')}).${
            updated.verificationReviewNote ? ` Note: ${updated.verificationReviewNote}` : ''
          }`,
        });

        res.json({ user: updated });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to review documents';
        res.status(500).json({ error: msg });
      }
    }
  );

  app.patch(
    '/api/admin/vehicles/:id/status',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const admin = await getOrCreateUser({
          uid: req.user!.uid,
          email: req.user!.email || '',
        });
        if (!admin.isAdmin)
          return res.status(403).json({ error: 'Admin access required.' });

        const targetId = Number(req.params.id);
        const { verificationStatus, reviewNote, alsoVerifyOwnerCnic } = req.body;
        if (!['pending', 'verified', 'rejected'].includes(verificationStatus)) {
          return res.status(400).json({ error: 'Invalid status.' });
        }

        const cleanNote =
          typeof reviewNote === 'string' && reviewNote.trim()
            ? reviewNote.trim().slice(0, 300)
            : `Admin marked vehicle ${verificationStatus}.`;

        const [updated] = await db
          .update(vehicles)
          .set({
            verificationStatus,
            reviewedByAdminId: admin.id,
            reviewedAt: new Date(),
            reviewNote: cleanNote,
          })
          .where(eq(vehicles.id, targetId))
          .returning();

        if (!updated) {
          return res.status(404).json({ error: 'Vehicle not found.' });
        }

        await db
          .update(verificationRecords)
          .set({
            status: verificationStatus,
            reviewedByAdminId: admin.id,
            reviewedAt: new Date(),
            reviewNote: cleanNote,
          })
          .where(eq(verificationRecords.relatedVehicleId, targetId));

        if (alsoVerifyOwnerCnic && verificationStatus === 'verified') {
          await db
            .update(users)
            .set({
              cnicVerificationStatus: 'verified',
              verificationReviewNote: cleanNote,
              updatedAt: new Date(),
            })
            .where(eq(users.id, updated.ownerUserId));

          await db
            .update(verificationRecords)
            .set({
              status: 'verified',
              reviewedByAdminId: admin.id,
              reviewedAt: new Date(),
              reviewNote: cleanNote,
            })
            .where(
              and(
                eq(verificationRecords.userId, updated.ownerUserId),
                eq(verificationRecords.documentType, 'cnic_driver')
              )
            );
        } else if (verificationStatus === 'rejected' && alsoVerifyOwnerCnic) {
          await db
            .update(users)
            .set({
              cnicVerificationStatus: 'rejected',
              verificationReviewNote: cleanNote,
              updatedAt: new Date(),
            })
            .where(eq(users.id, updated.ownerUserId));
        }

        await db.insert(auditLogs).values({
          adminUserId: admin.id,
          action: `VEHICLE_${verificationStatus.toUpperCase()}`,
          targetType: 'vehicle',
          targetId,
          details: `Vehicle ${updated.registrationNumber} marked ${verificationStatus}${
            alsoVerifyOwnerCnic ? ' (+ owner CNIC updated)' : ''
          }`,
        });

        await db.insert(notifications).values({
          userId: updated.ownerUserId,
          type: 'document_verification',
          title: `Vehicle ${updated.registrationNumber} ${verificationStatus}`,
          body: cleanNote,
        });

        res.json({ vehicle: updated });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to update vehicle';
        res.status(500).json({ error: msg });
      }
    }
  );

  app.patch(
    '/api/admin/services/:id/status',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const admin = await getOrCreateUser({
          uid: req.user!.uid,
          email: req.user!.email || '',
        });
        if (!admin.isAdmin)
          return res.status(403).json({ error: 'Admin access required.' });

        const targetId = Number(req.params.id);
        const { verificationStatus, reviewNote, alsoVerifyOwnerCnic } = req.body;
        if (!['pending', 'verified', 'rejected'].includes(verificationStatus)) {
          return res.status(400).json({ error: 'Invalid status.' });
        }

        const cleanNote =
          typeof reviewNote === 'string' && reviewNote.trim()
            ? reviewNote.trim().slice(0, 300)
            : `Admin marked carry service ${verificationStatus}.`;

        const [updated] = await db
          .update(transportServices)
          .set({
            verificationStatus,
            reviewedByAdminId: admin.id,
            reviewedAt: new Date(),
            reviewNote: cleanNote,
          })
          .where(eq(transportServices.id, targetId))
          .returning();

        if (!updated) {
          return res.status(404).json({ error: 'Transport service not found.' });
        }

        await db
          .update(verificationRecords)
          .set({
            status: verificationStatus,
            reviewedByAdminId: admin.id,
            reviewedAt: new Date(),
            reviewNote: cleanNote,
          })
          .where(eq(verificationRecords.relatedServiceId, targetId));

        if (alsoVerifyOwnerCnic && verificationStatus === 'verified') {
          await db
            .update(users)
            .set({
              cnicVerificationStatus: 'verified',
              verificationReviewNote: cleanNote,
              updatedAt: new Date(),
            })
            .where(eq(users.id, updated.coordinatorUserId));

          await db
            .update(verificationRecords)
            .set({
              status: 'verified',
              reviewedByAdminId: admin.id,
              reviewedAt: new Date(),
              reviewNote: cleanNote,
            })
            .where(
              and(
                eq(verificationRecords.userId, updated.coordinatorUserId),
                eq(verificationRecords.documentType, 'cnic_driver')
              )
            );
        } else if (verificationStatus === 'rejected' && alsoVerifyOwnerCnic) {
          await db
            .update(users)
            .set({
              cnicVerificationStatus: 'rejected',
              verificationReviewNote: cleanNote,
              updatedAt: new Date(),
            })
            .where(eq(users.id, updated.coordinatorUserId));
        }

        await db.insert(auditLogs).values({
          adminUserId: admin.id,
          action: `SERVICE_${verificationStatus.toUpperCase()}`,
          targetType: 'transport_service',
          targetId,
          details: `Transport service ${updated.serviceName} marked ${verificationStatus}${
            alsoVerifyOwnerCnic ? ' (+ coordinator CNIC updated)' : ''
          }`,
        });

        await db.insert(notifications).values({
          userId: updated.coordinatorUserId,
          type: 'document_verification',
          title: `Carry Service ${updated.serviceName} ${verificationStatus}`,
          body: cleanNote,
        });

        res.json({ service: updated });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to update service';
        res.status(500).json({ error: msg });
      }
    }
  );

  app.patch('/api/admin/reports/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) return res.status(403).json({ error: 'Admin access required.' });

      const targetId = Number(req.params.id);
      const { status, adminNotes } = req.body;
      if (!['open', 'investigating', 'resolved', 'dismissed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid report status.' });
      }

      const [updated] = await db
        .update(reports)
        .set({
          status,
          adminNotes: typeof adminNotes === 'string' ? adminNotes.trim() : null,
        })
        .where(eq(reports.id, targetId))
        .returning();

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: `REPORT_${status.toUpperCase()}`,
        targetType: 'report',
        targetId,
        details: `Report #${targetId} updated to ${status}`,
      });

      res.json({ report: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update report';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/admin/routes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) return res.status(403).json({ error: 'Admin access required.' });

      const { campusId, originCity, destinationCity, distanceKm } = req.body;
      if (!originCity || !destinationCity) {
        return res
          .status(400)
          .json({ error: 'Origin and destination cities are required.' });
      }

      const [created] = await db
        .insert(routes)
        .values({
          campusId: Number(campusId) || 1,
          originCity: String(originCity).trim(),
          destinationCity: String(destinationCity).trim(),
          corridorLabel: `${String(originCity).trim()} → ${String(destinationCity).trim()}`,
          distanceKm: Math.max(1, Number(distanceKm) || 40),
          isActive: true,
        })
        .returning();

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'ROUTE_CREATED',
        targetType: 'route',
        targetId: created.id,
        details: `Added corridor ${created.corridorLabel}`,
      });

      res.status(201).json({ route: created });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create route';
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`NUCESPOOL server listening on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
