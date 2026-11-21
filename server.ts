import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
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
  rideRequests,
  rideSchedules,
  rides,
  routes,
  sosAlerts,
  timetableSlots,
  transportServices,
  users,
  vehicles,
  verificationRecords,
} from './src/db/schema.ts';
import { getOrCreateUser, isSuperAdminEmail } from './src/db/users.ts';
import {
  acceptRideRequestTransactional,
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

  const resolvePublicBaseUrl = (req: express.Request): string => {
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(protoHeader)
      ? protoHeader[0]
      : (protoHeader || req.protocol || 'https').split(',')[0].trim();
    const fwdHostHeader = req.headers['x-forwarded-host'];
    const fwdHost = Array.isArray(fwdHostHeader)
      ? fwdHostHeader[0]
      : fwdHostHeader?.split(',')[0].trim();
    const host = fwdHost || req.get('host');
    if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      return `${proto}://${host}`;
    }
    const envUrl = process.env.APP_URL?.trim().replace(/\/+$/, '');
    if (envUrl) return envUrl;
    if (host) return `${proto}://${host}`;
    return 'https://nucespool.ai.studio';
  };

  app.get('/google3ca2d8e37432bce0.html', (_req, res) => {
    res
      .type('text/html; charset=utf-8')
      .send('google-site-verification: google3ca2d8e37432bce0.html');
  });

  app.get('/robots.txt', (req, res) => {
    const baseUrl = resolvePublicBaseUrl(req);
    res.type('text/plain').send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: Googlebot',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: Bingbot',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: OAI-SearchBot',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: GPTBot',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: PerplexityBot',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: ClaudeBot',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        'User-agent: Google-Extended',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
      ].join('\n')
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = resolvePublicBaseUrl(req);
    const todayIso = new Date().toISOString().slice(0, 10);
    const pages = [
      { loc: `${baseUrl}/`, changefreq: 'daily', priority: '1.0' },
      { loc: `${baseUrl}/offer`, changefreq: 'daily', priority: '0.9' },
      { loc: `${baseUrl}/timetable`, changefreq: 'weekly', priority: '0.9' },
      { loc: `${baseUrl}/rides`, changefreq: 'daily', priority: '0.8' },
      { loc: `${baseUrl}/messages`, changefreq: 'weekly', priority: '0.7' },
      { loc: `${baseUrl}/profile`, changefreq: 'weekly', priority: '0.7' },
    ];
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        pages
          .map(
            (p) =>
              `  <url>\n` +
              `    <loc>${p.loc}</loc>\n` +
              `    <lastmod>${todayIso}</lastmod>\n` +
              `    <changefreq>${p.changefreq}</changefreq>\n` +
              `    <priority>${p.priority}</priority>\n` +
              `  </url>\n`
          )
          .join('') +
        `</urlset>\n`
    );
  });

  app.get('/llms.txt', (req, res) => {
    const baseUrl = resolvePublicBaseUrl(req);
    res.type('text/plain; charset=utf-8').send(
      [
        '# NUCESPOOL',
        '',
        '> Student carpooling and daily ride sharing for FAST-NUCES Chiniot-Faisalabad Campus.',
        '',
        'NUCESPOOL connects verified FAST-NUCES students commuting on the Chiniot to Faisalabad corridor. Students find open seats in personal cars or campus carry vans and split fuel plus any traffic challans in cash.',
        '',
        '## Region and Campus',
        '',
        '- Campus: FAST-NUCES Chiniot-Faisalabad Campus (CFD), Chiniot Road, Punjab, Pakistan',
        '- Coordinates: 31.6025, 73.0358',
        '- Primary Corridor: Chiniot <-> Faisalabad (M-3 / Sargodha Road / Chiniot Road)',
        '- Common Stops: Satellite Town Chiniot, Chiniot Bridge, Loonaywala Stop, Gatwala, Canal Road, Kohinoor Chowk, D-Ground Faisalabad, Peoples Colony, Millat Town, Jhang Road',
        '',
        '## How NUCESPOOL Works',
        '',
        '- Passenger verification: Students upload their FAST-NUCES Student ID Card and roll number before booking seats.',
        '- Driver and vehicle verification: Drivers and carry coordinators submit their 13-digit CNIC and vehicle plate for manual Campus Admin approval before posting rides.',
        '- Timetable match: Students enter classes or upload a timetable (PDF, image, CSV, TXT) so rides rank by first class and last dismissal.',
        '- Cash cost split: Fuel splits evenly per passenger (or fixed per seat) and gets paid in cash on the ride. Traffic e-challans or warden fines split equally across everyone inside the car.',
        '- Live pins and SOS safety: Riders share real-time pickup pins on Google Maps and can trigger an SOS alert to notify everyone on the ride plus campus admins.',
        '',
        '## Canonical URL',
        '',
        `- ${baseUrl}/`,
        '',
      ].join('\n')
    );
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
      const hasNuDomain = Boolean(
        normalizedNu &&
          (normalizedNu.endsWith('@nu.edu.pk') ||
            normalizedNu.endsWith('@cfd.nu.edu.pk'))
      );

      const nextStatus =
        current.verificationStatus === 'suspended'
          ? 'suspended'
          : current.verificationStatus === 'rejected'
          ? 'rejected'
          : current.verificationStatus === 'verified'
          ? 'verified'
          : hasNuDomain
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

      if (current.verificationStatus === 'suspended') {
        return res.status(403).json({
          error: 'Suspended accounts cannot upload verification documents.',
        });
      }

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

      const wasRejectedByAdmin =
        current.studentCardStatus === 'rejected' ||
        current.verificationStatus === 'rejected';
      const nextCardStatus = wasRejectedByAdmin ? 'pending' : 'verified';
      const nextAccountStatus = wasRejectedByAdmin ? 'pending' : 'verified';
      const reviewNote = wasRejectedByAdmin
        ? 'Updated Student ID Card photo saved to database and submitted for Campus Admin re-review.'
        : 'Student ID Card saved to database. Profile verified for carpooling & booking shared rides (offering rides still requires manual Admin CNIC verification).';

      const [updated] = await db
        .update(users)
        .set({
          rollNumber: cleanRoll,
          studentCardImageUrl: validCardImage,
          studentCardStatus: nextCardStatus,
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
        status: nextCardStatus,
        reviewNote,
        reviewedAt: nextCardStatus === 'verified' ? new Date() : null,
      });

      await db.insert(notifications).values({
        userId: current.id,
        type: 'document_verification',
        title:
          nextCardStatus === 'verified'
            ? 'Student ID Card Saved & Verified (Passenger Access)'
            : 'Updated Student ID Card Submitted for Admin Review',
        body: reviewNote,
      });

      res.json({
        user: { ...updated, isSuperAdmin: current.isSuperAdmin },
        status: nextCardStatus,
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

      if (current.verificationStatus === 'suspended') {
        return res.status(403).json({
          error: 'Suspended accounts cannot upload verification documents.',
        });
      }

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
        title: 'CNIC Uploaded. Waiting on Admin Review',
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
            type:
              nextStatus === 'cancelled'
                ? 'ride_cancelled'
                : nextStatus === 'completed'
                ? 'ride_completed'
                : 'ride_updated',
            title:
              nextStatus === 'cancelled'
                ? 'Ride cancelled by provider'
                : nextStatus === 'completed'
                ? 'Ride finished. Rate your driver'
                : 'Ride departure updated',
            body:
              nextStatus === 'cancelled'
                ? `${ride.originCity} → ${ride.destinationCity} on ${ride.travelDate} was cancelled.`
                : nextStatus === 'completed'
                ? `Your ${ride.originCity} → ${ride.destinationCity} ride on ${ride.travelDate} is done. Leave a rating and short note for your driver.`
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

  // Publish an open passenger ride request (visible to all drivers)
  app.post('/api/ride-requests', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (user.verificationStatus === 'suspended') {
        return res.status(403).json({ error: 'Suspended accounts cannot post ride requests.' });
      }
      if (!user.isAdmin && user.studentCardStatus !== 'verified') {
        return res.status(403).json({
          error:
            'Verify your FAST Student ID Card in Profile before publishing a ride request.',
        });
      }

      const {
        routeId,
        originArea,
        destinationArea,
        pickupPoint,
        travelDate,
        preferredTime,
        returnTime,
        journeyType,
        seatsNeeded,
        maxBudgetPerSeat,
        notes,
      } = req.body;

      const [route] = await db
        .select()
        .from(routes)
        .where(eq(routes.id, Number(routeId)))
        .limit(1);
      if (!route) {
        return res.status(400).json({ error: 'Selected corridor route does not exist.' });
      }

      const cleanOriginArea = String(originArea || route.originCity).trim();
      const cleanDestArea = String(destinationArea || route.destinationCity).trim();
      const cleanPickup = String(pickupPoint || cleanOriginArea).trim();
      const cleanDate =
        typeof travelDate === 'string' && travelDate.length === 10
          ? travelDate
          : new Date().toISOString().slice(0, 10);
      const cleanTime = normalizeTimeHHMM(preferredTime, '08:00');
      const safeJourney = ['morning', 'evening', 'round_trip'].includes(journeyType)
        ? journeyType
        : 'morning';
      const cleanReturn =
        safeJourney !== 'morning' && returnTime
          ? normalizeTimeHHMM(returnTime, '15:30')
          : null;
      const seatsNum = Math.max(1, Math.min(6, Number(seatsNeeded) || 1));
      const budgetNum = Math.max(50, Math.min(5000, Number(maxBudgetPerSeat) || 400));

      const [created] = await db
        .insert(rideRequests)
        .values({
          passengerUserId: user.id,
          routeId: route.id,
          originCity: route.originCity,
          originArea: cleanOriginArea,
          destinationCity: route.destinationCity,
          destinationArea: cleanDestArea,
          pickupPoint: cleanPickup,
          travelDate: cleanDate,
          preferredTime: cleanTime,
          returnTime: cleanReturn,
          journeyType: safeJourney,
          seatsNeeded: seatsNum,
          maxBudgetPerSeat: budgetNum,
          notes: notes ? String(notes).trim() : null,
          status: 'open',
        })
        .returning();

      // Notify verified drivers & carry coordinators so they immediately see the new passenger request
      const drivers = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            ne(users.id, user.id),
            or(
              eq(users.isDriver, true),
              eq(users.isCoordinator, true),
              eq(users.cnicVerificationStatus, 'verified')
            )
          )
        );

      if (drivers.length > 0) {
        await db.insert(notifications).values(
          drivers.slice(0, 50).map((d) => ({
            userId: d.id,
            type: 'passenger_ride_request',
            title: 'New Passenger Ride Request',
            body: `${user.fullName} needs ${seatsNum} seat(s) from ${cleanOriginArea} → ${cleanDestArea} on ${cleanDate} at ${cleanTime} (up to PKR ${budgetNum}/seat).`,
          }))
        );
      }

      res.status(201).json({ rideRequest: created });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to publish ride request.';
      res.status(500).json({ error: msg });
    }
  });

  // Driver picks up / accepts an open passenger ride request
  app.post('/api/ride-requests/:id/accept', requireAuth, async (req: AuthRequest, res) => {
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
            'Driver CNIC verification and FAST Student ID Card verification are required in Profile before picking up ride requests.',
        });
      }

      const requestId = Number(req.params.id);
      const { vehicleId, transportServiceId, existingRideId, farePerSeat } = req.body;

      const result = await acceptRideRequestTransactional({
        requestId,
        driverUserId: user.id,
        isAdmin: Boolean(user.isAdmin),
        vehicleId: vehicleId ? Number(vehicleId) : null,
        transportServiceId: transportServiceId ? Number(transportServiceId) : null,
        existingRideId: existingRideId ? Number(existingRideId) : null,
        farePerSeat: farePerSeat ? Number(farePerSeat) : null,
      });

      res.status(201).json(result);
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : '';
      const map: Record<string, [number, string]> = {
        REQUEST_NOT_FOUND: [404, 'Ride request not found.'],
        REQUEST_NOT_OPEN: [409, 'This ride request has already been picked up or cancelled.'],
        CANNOT_ACCEPT_OWN_REQUEST: [400, 'You cannot accept your own ride request.'],
        INSUFFICIENT_SEATS_ON_RIDE: [409, 'Your selected ride does not have enough seats left.'],
        VEHICLE_NOT_FOUND: [404, 'Selected vehicle was not found on your account.'],
        VEHICLE_NOT_VERIFIED: [403, 'Your vehicle is still awaiting Campus Admin verification.'],
        SERVICE_NOT_FOUND: [404, 'Selected carry service was not found on your account.'],
        SERVICE_NOT_VERIFIED: [403, 'Your carry service is still awaiting Campus Admin verification.'],
        TRANSPORT_REQUIRED: [400, 'Select a registered vehicle, carry service, or active ride.'],
      };
      if (map[code]) {
        return res.status(map[code][0]).json({ error: map[code][1] });
      }
      res.status(500).json({ error: 'Failed to accept passenger ride request.' });
    }
  });

  // Passenger cancels their open ride request
  app.patch('/api/ride-requests/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const requestId = Number(req.params.id);
      const [existing] = await db
        .select()
        .from(rideRequests)
        .where(eq(rideRequests.id, requestId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: 'Ride request not found.' });
      }
      if (existing.passengerUserId !== user.id && !user.isAdmin) {
        return res.status(403).json({ error: 'Not authorized to cancel this request.' });
      }
      if (existing.status !== 'open') {
        return res.status(400).json({ error: 'Only open ride requests can be cancelled.' });
      }

      const [updated] = await db
        .update(rideRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(rideRequests.id, requestId))
        .returning();

      res.json({ rideRequest: updated });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to cancel ride request.';
      res.status(500).json({ error: msg });
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
            inArray(bookings.status, ['pending', 'accepted', 'completed'])
          )
        )
        .limit(1);

      if (!isDriver && !activeBooking && !user.isAdmin) {
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
      let savedLocation;
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
        savedLocation = updated;
      } else {
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
        savedLocation = created;
      }

      // Keep any active SOS alert coordinates synced in real time
      if (sharingFlag && !Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
        await db
          .update(sosAlerts)
          .set({
            lat: latNum,
            lng: lngNum,
          })
          .where(
            and(
              eq(sosAlerts.rideId, rideId),
              eq(sosAlerts.triggeredByUserId, user.id),
              eq(sosAlerts.status, 'active')
            )
          );
      }

      res.status(existing.length > 0 ? 200 : 201).json({ location: savedLocation });
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
            inArray(bookings.status, ['pending', 'accepted', 'completed'])
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

  // Squad SOS / Emergency Alert Endpoints
  app.get('/api/rides/:id/sos', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const rideId = Number(req.params.id);

      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const isDriver = ride.providerUserId === user.id;
      const [participantBooking] = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, rideId),
            eq(bookings.passengerUserId, user.id),
            inArray(bookings.status, ['pending', 'accepted', 'completed'])
          )
        )
        .limit(1);

      if (!isDriver && !participantBooking && !user.isAdmin) {
        return res.status(403).json({
          error: 'Only ride squad members can access SOS alerts for this ride.',
        });
      }

      const [alertRows, locRows] = await Promise.all([
        db
          .select()
          .from(sosAlerts)
          .where(eq(sosAlerts.rideId, rideId))
          .orderBy(desc(sosAlerts.createdAt))
          .limit(20),
        db
          .select()
          .from(liveLocations)
          .where(
            and(eq(liveLocations.rideId, rideId), eq(liveLocations.isSharing, true))
          )
          .orderBy(desc(liveLocations.updatedAt)),
      ]);

      const userIds = Array.from(
        new Set([
          ...alertRows.map((a) => a.triggeredByUserId),
          ...locRows.map((l) => l.userId),
        ])
      );
      const userRows =
        userIds.length > 0
          ? await db
              .select({
                id: users.id,
                fullName: users.fullName,
                avatarUrl: users.avatarUrl,
                rollNumber: users.rollNumber,
                phone: users.phone,
              })
              .from(users)
              .where(inArray(users.id, userIds))
          : [];
      const uMap = new Map(userRows.map((u) => [u.id, u]));

      const alerts = alertRows.map((a) => {
        const sender = uMap.get(a.triggeredByUserId);
        return {
          ...a,
          triggeredByName: sender?.fullName ?? 'FAST Student',
          triggeredByAvatarUrl: sender?.avatarUrl ?? null,
          triggeredByRollNumber: sender?.rollNumber ?? null,
          triggeredByPhone: sender?.phone ?? null,
        };
      });

      const locations = locRows.map((l) => ({
        ...l,
        fullName: uMap.get(l.userId)?.fullName ?? 'Student',
        avatarUrl: uMap.get(l.userId)?.avatarUrl ?? null,
      }));

      res.json({ alerts, locations });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load SOS alerts';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/rides/:id/sos', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const rideId = Number(req.params.id);

      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const isDriver = ride.providerUserId === user.id;
      const [participantBooking] = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, rideId),
            eq(bookings.passengerUserId, user.id),
            inArray(bookings.status, ['pending', 'accepted', 'completed'])
          )
        )
        .limit(1);

      if (!isDriver && !participantBooking && !user.isAdmin) {
        return res.status(403).json({
          error: 'Only squad members on this ride can trigger an SOS alert.',
        });
      }

      const rawLat = Number(req.body?.lat);
      const rawLng = Number(req.body?.lng);
      const hasValidCoords =
        Number.isFinite(rawLat) &&
        Number.isFinite(rawLng) &&
        rawLat >= -90 &&
        rawLat <= 90 &&
        rawLng >= -180 &&
        rawLng <= 180 &&
        !(rawLat === 0 && rawLng === 0);

      const lat = hasValidCoords ? rawLat : 31.6025;
      const lng = hasValidCoords ? rawLng : 73.0358;
      const accuracyMeters = Number.isFinite(Number(req.body?.accuracyMeters))
        ? Math.max(0, Math.round(Number(req.body?.accuracyMeters)))
        : null;
      const noteText =
        typeof req.body?.message === 'string' && req.body.message.trim()
          ? req.body.message.trim().slice(0, 280)
          : hasValidCoords
          ? 'SOS triggered by a rider. Live GPS pin shared.'
          : 'SOS triggered by a rider (GPS blocked on device, corridor pin attached).';

      const existingActive = await db
        .select()
        .from(sosAlerts)
        .where(
          and(
            eq(sosAlerts.rideId, rideId),
            eq(sosAlerts.triggeredByUserId, user.id),
            eq(sosAlerts.status, 'active')
          )
        )
        .limit(1);

      let savedAlert;
      if (existingActive.length > 0) {
        const [updated] = await db
          .update(sosAlerts)
          .set({
            lat,
            lng,
            accuracyMeters,
            message: noteText,
          })
          .where(eq(sosAlerts.id, existingActive[0].id))
          .returning();
        savedAlert = updated;
      } else {
        const [created] = await db
          .insert(sosAlerts)
          .values({
            rideId,
            triggeredByUserId: user.id,
            lat,
            lng,
            accuracyMeters,
            message: noteText,
            status: 'active',
          })
          .returning();
        savedAlert = created;
      }

      // Also enable real-time liveLocations sharing for this user on the ride
      const role = isDriver ? 'driver' : 'passenger';
      const existingLoc = await db
        .select()
        .from(liveLocations)
        .where(
          and(eq(liveLocations.rideId, rideId), eq(liveLocations.userId, user.id))
        )
        .limit(1);
      if (existingLoc.length > 0) {
        await db
          .update(liveLocations)
          .set({
            role,
            lat,
            lng,
            note: `SOS ACTIVE: ${noteText.slice(0, 90)}`,
            isSharing: true,
            updatedAt: new Date(),
          })
          .where(eq(liveLocations.id, existingLoc[0].id));
      } else {
        await db.insert(liveLocations).values({
          rideId,
          userId: user.id,
          role,
          lat,
          lng,
          note: `SOS ACTIVE: ${noteText.slice(0, 90)}`,
          isSharing: true,
          updatedAt: new Date(),
        });
      }

      // Gather all other squad members + campus admins to alert
      const [rideBookings, adminUsers] = await Promise.all([
        db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.rideId, rideId),
              inArray(bookings.status, ['pending', 'accepted', 'completed'])
            )
          ),
        db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)),
      ]);

      const squadMemberIds = new Set<number>([
        ride.providerUserId,
        ...rideBookings.map((b) => b.passengerUserId),
      ]);
      const recipientIds = new Set<number>([
        ...squadMemberIds,
        ...adminUsers.map((a) => a.id),
      ]);
      recipientIds.delete(user.id);

      const coordsLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (recipientIds.size > 0) {
        await db.insert(notifications).values(
          Array.from(recipientIds).map((uid) => ({
            userId: uid,
            type: 'sos_alert',
            title: `SOS Alert · ${user.fullName} (${ride.originCity} → ${ride.destinationCity})`,
            body: `${noteText} Live GPS: ${coordsLabel}`,
            relatedRideId: rideId,
          }))
        );
      }

      // Drop an automated alert into Squad Chat with the other ride participants
      const chatTargets = Array.from(squadMemberIds).filter((id) => id !== user.id);
      if (chatTargets.length > 0) {
        await db.insert(messages).values(
          chatTargets.map((receiverId) => ({
            rideId,
            senderUserId: user.id,
            receiverUserId: receiverId,
            content: `[SOS ALERT] ${noteText} | Live location: https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`,
          }))
        );
      }

      res.status(201).json({
        alert: {
          ...savedAlert,
          triggeredByName: user.fullName,
          triggeredByAvatarUrl: user.avatarUrl,
          triggeredByRollNumber: user.rollNumber,
          triggeredByPhone: user.phone,
        },
        alertedCount: recipientIds.size,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to trigger SOS alert';
      res.status(500).json({ error: msg });
    }
  });

  app.patch(
    '/api/rides/:id/sos/:alertId/resolve',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const user = await getOrCreateUser({
          uid: req.user!.uid,
          email: req.user!.email || '',
        });
        const rideId = Number(req.params.id);
        const alertId = Number(req.params.alertId);

        const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
        if (!ride) return res.status(404).json({ error: 'Ride not found.' });

        const [alert] = await db
          .select()
          .from(sosAlerts)
          .where(and(eq(sosAlerts.id, alertId), eq(sosAlerts.rideId, rideId)))
          .limit(1);
        if (!alert) return res.status(404).json({ error: 'SOS alert not found.' });

        if (
          alert.triggeredByUserId !== user.id &&
          ride.providerUserId !== user.id &&
          !user.isAdmin
        ) {
          return res.status(403).json({
            error: 'Only the alert sender, ride driver, or admin can resolve this SOS.',
          });
        }

        const [updated] = await db
          .update(sosAlerts)
          .set({
            status: 'resolved',
            resolvedAt: new Date(),
          })
          .where(eq(sosAlerts.id, alertId))
          .returning();

        await db
          .update(liveLocations)
          .set({ isSharing: false, updatedAt: new Date() })
          .where(
            and(
              eq(liveLocations.rideId, rideId),
              eq(liveLocations.userId, alert.triggeredByUserId)
            )
          );

        const rideBookings = await db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.rideId, rideId),
              inArray(bookings.status, ['pending', 'accepted', 'completed'])
            )
          );
        const notifyIds = new Set<number>([
          ride.providerUserId,
          ...rideBookings.map((b) => b.passengerUserId),
        ]);
        notifyIds.delete(user.id);

        if (notifyIds.size > 0) {
          await db.insert(notifications).values(
            Array.from(notifyIds).map((uid) => ({
              userId: uid,
              type: 'sos_resolved',
              title: `SOS Alert Resolved · ${ride.originCity} → ${ride.destinationCity}`,
              body: `${user.fullName} marked the SOS alert on this ride as safe / resolved.`,
              relatedRideId: rideId,
            }))
          );
        }

        res.json({ alert: updated });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to resolve SOS alert';
        res.status(500).json({ error: msg });
      }
    }
  );

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

      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (
        isSuperAdminEmail(target.email) &&
        !admin.isSuperAdmin &&
        verificationStatus === 'suspended'
      ) {
        return res
          .status(403)
          .json({ error: 'Only a Super Admin can modify a Super Admin account.' });
      }

      const updateFields: Record<string, unknown> = {
        verificationStatus,
        updatedAt: new Date(),
      };
      if (verificationStatus === 'pending' && req.body?.unverifyDocs) {
        updateFields.studentCardStatus =
          target.studentCardImageUrl ? 'pending' : 'unsubmitted';
        updateFields.cnicVerificationStatus =
          target.cnicImageUrl ? 'pending' : 'unsubmitted';
      } else if (verificationStatus === 'rejected' && req.body?.unverifyDocs) {
        updateFields.studentCardStatus = 'rejected';
        updateFields.cnicVerificationStatus = 'rejected';
      }

      const [updated] = await db
        .update(users)
        .set(updateFields)
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
          title:
            verificationStatus === 'pending'
              ? 'Account verification reset (Unverified)'
              : `Account status: ${verificationStatus}`,
          body:
            verificationStatus === 'verified'
              ? 'Your FAST-NUCES Chiniot student verification has been approved.'
              : verificationStatus === 'pending'
              ? 'An administrator unverified your account status. You can re-upload or wait for review.'
              : verificationStatus === 'rejected'
              ? 'Your verification was rejected by Admin. You can upload fresh documents in Profile.'
              : `Your student account verification status was updated to ${verificationStatus}.`,
        });
      }

      res.json({
        user: { ...updated, isSuperAdmin: isSuperAdminEmail(updated.email) },
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to update student status';
      res.status(500).json({ error: msg });
    }
  });

  // Admin review / unverify / reject of CNIC & Student ID Card documents
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

        const allowedDocStates = new Set([
          'unsubmitted',
          'pending',
          'verified',
          'rejected',
        ]);
        if (cnicVerificationStatus && !allowedDocStates.has(cnicVerificationStatus)) {
          return res.status(400).json({ error: 'Invalid CNIC verification status.' });
        }
        if (studentCardStatus && !allowedDocStates.has(studentCardStatus)) {
          return res.status(400).json({ error: 'Invalid Student Card status.' });
        }

        const nextCnicStatus =
          cnicVerificationStatus || target.cnicVerificationStatus;
        const nextCardStatus = studentCardStatus || target.studentCardStatus;

        let nextAccountStatus = target.verificationStatus;
        if (target.verificationStatus !== 'suspended') {
          if (nextCardStatus === 'verified' || nextCnicStatus === 'verified') {
            nextAccountStatus = 'verified';
          } else if (nextCardStatus === 'pending' || nextCnicStatus === 'pending') {
            nextAccountStatus = 'pending';
          } else if (nextCardStatus === 'rejected' || nextCnicStatus === 'rejected') {
            nextAccountStatus = 'rejected';
          } else {
            nextAccountStatus = 'pending';
          }
        }

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

        if (cnicVerificationStatus && cnicVerificationStatus !== 'unsubmitted') {
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
        if (studentCardStatus && studentCardStatus !== 'unsubmitted') {
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

        res.json({
          user: { ...updated, isSuperAdmin: isSuperAdminEmail(updated.email) },
        });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to review documents';
        res.status(500).json({ error: msg });
      }
    }
  );

  // Admin: Delete uploaded user document images & reset status so user can re-upload
  app.delete(
    '/api/admin/users/:id/documents/:docType',
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
        const docType = String(req.params.docType);
        if (!['student_card', 'cnic', 'avatar', 'all'].includes(docType)) {
          return res.status(400).json({ error: 'Invalid document type.' });
        }

        const [target] = await db
          .select()
          .from(users)
          .where(eq(users.id, targetId))
          .limit(1);
        if (!target) return res.status(404).json({ error: 'User not found.' });

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        const clearedTypes: string[] = [];

        if (docType === 'student_card' || docType === 'all') {
          updates.studentCardImageUrl = null;
          updates.studentCardStatus = 'unsubmitted';
          clearedTypes.push('student_card');
        }
        if (docType === 'cnic' || docType === 'all') {
          updates.cnicImageUrl = null;
          updates.cnicNumber = null;
          updates.cnicVerificationStatus = 'unsubmitted';
          clearedTypes.push('cnic_driver');
        }
        if (docType === 'avatar' || docType === 'all') {
          updates.avatarUrl = null;
        }

        const nextCard =
          docType === 'student_card' || docType === 'all'
            ? 'unsubmitted'
            : target.studentCardStatus;
        const nextCnic =
          docType === 'cnic' || docType === 'all'
            ? 'unsubmitted'
            : target.cnicVerificationStatus;

        if (target.verificationStatus !== 'suspended') {
          if (nextCard === 'verified' || nextCnic === 'verified') {
            updates.verificationStatus = 'verified';
          } else if (nextCard === 'rejected' || nextCnic === 'rejected') {
            updates.verificationStatus = 'rejected';
          } else {
            updates.verificationStatus = 'pending';
          }
        }

        updates.verificationReviewNote =
          'Uploaded document image deleted by Admin. Please upload a clear document photo again.';

        const [updated] = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, targetId))
          .returning();

        if (clearedTypes.length > 0) {
          await db
            .delete(verificationRecords)
            .where(
              and(
                eq(verificationRecords.userId, targetId),
                inArray(verificationRecords.documentType, clearedTypes)
              )
            );
        }

        await db.insert(auditLogs).values({
          adminUserId: admin.id,
          action: 'DOCUMENTS_DELETED',
          targetType: 'user',
          targetId,
          details: `Deleted ${docType} uploaded image(s) for ${updated.fullName} (${updated.email})`,
        });

        await db.insert(notifications).values({
          userId: updated.id,
          type: 'document_verification',
          title: 'Uploaded Document Cleared by Admin',
          body: `Your uploaded ${docType.replace('_', ' ')} image was removed by Admin so you can upload a fresh, clear copy.`,
        });

        res.json({
          user: { ...updated, isSuperAdmin: isSuperAdminEmail(updated.email) },
        });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to delete uploaded documents';
        res.status(500).json({ error: msg });
      }
    }
  );

  // Admin: Delete a specific verification record & image from database
  app.delete(
    '/api/admin/verification-records/:id',
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

        const recordId = Number(req.params.id);
        const [record] = await db
          .select()
          .from(verificationRecords)
          .where(eq(verificationRecords.id, recordId))
          .limit(1);
        if (!record) {
          return res.status(404).json({ error: 'Verification record not found.' });
        }

        await db
          .delete(verificationRecords)
          .where(eq(verificationRecords.id, recordId));

        if (record.documentType === 'student_card') {
          await db
            .update(users)
            .set({
              studentCardImageUrl: null,
              studentCardStatus: 'unsubmitted',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(users.id, record.userId),
                eq(users.studentCardImageUrl, record.documentImageUrl || '')
              )
            );
        } else if (record.documentType === 'cnic_driver') {
          await db
            .update(users)
            .set({
              cnicImageUrl: null,
              cnicVerificationStatus: 'unsubmitted',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(users.id, record.userId),
                eq(users.cnicImageUrl, record.documentImageUrl || '')
              )
            );
        }

        await db.insert(auditLogs).values({
          adminUserId: admin.id,
          action: 'VERIFICATION_RECORD_DELETED',
          targetType: 'verification_record',
          targetId: recordId,
          details: `Deleted ${record.documentType} record #${recordId} (user #${record.userId})`,
        });

        res.json({ ok: true });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Failed to delete verification record';
        res.status(500).json({ error: msg });
      }
    }
  );

  // Admin: Delete a student/user record cleanly with cascading cleanup
  app.delete('/api/admin/users/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const targetId = Number(req.params.id);
      if (targetId === admin.id) {
        return res
          .status(400)
          .json({ error: 'You cannot delete your own active account.' });
      }

      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      if (isSuperAdminEmail(target.email)) {
        return res
          .status(403)
          .json({ error: 'Primary Super Admin accounts cannot be deleted.' });
      }

      await db.transaction(async (tx) => {
        const userRides = await tx
          .select({ id: rides.id })
          .from(rides)
          .where(eq(rides.providerUserId, targetId));
        const userRideIds = userRides.map((r) => r.id);

        const userBookings = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(eq(bookings.passengerUserId, targetId));
        const userBookingIds = userBookings.map((b) => b.id);

        const userMsgs = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            sql`${messages.senderUserId} = ${targetId} OR ${messages.receiverUserId} = ${targetId}`
          );
        const userMsgIds = userMsgs.map((m) => m.id);

        await tx
          .delete(messageReactions)
          .where(eq(messageReactions.userId, targetId));
        if (userMsgIds.length > 0) {
          await tx
            .delete(messageReactions)
            .where(inArray(messageReactions.messageId, userMsgIds));
        }
        await tx
          .delete(messages)
          .where(
            sql`${messages.senderUserId} = ${targetId} OR ${messages.receiverUserId} = ${targetId}`
          );
        if (userRideIds.length > 0) {
          await tx.delete(messages).where(inArray(messages.rideId, userRideIds));
        }

        await tx
          .delete(reviews)
          .where(
            sql`${reviews.reviewerUserId} = ${targetId} OR ${reviews.revieweeUserId} = ${targetId}`
          );
        if (userBookingIds.length > 0) {
          await tx.delete(reviews).where(inArray(reviews.bookingId, userBookingIds));
        }
        if (userRideIds.length > 0) {
          await tx.delete(reviews).where(inArray(reviews.rideId, userRideIds));
        }

        await tx
          .delete(rideChallans)
          .where(eq(rideChallans.reportedByUserId, targetId));
        if (userRideIds.length > 0) {
          await tx
            .delete(rideChallans)
            .where(inArray(rideChallans.rideId, userRideIds));
        }

        await tx
          .delete(sosAlerts)
          .where(eq(sosAlerts.triggeredByUserId, targetId));
        await tx
          .delete(liveLocations)
          .where(eq(liveLocations.userId, targetId));
        if (userRideIds.length > 0) {
          await tx.delete(sosAlerts).where(inArray(sosAlerts.rideId, userRideIds));
          await tx
            .delete(liveLocations)
            .where(inArray(liveLocations.rideId, userRideIds));
        }

        await tx
          .delete(reports)
          .where(
            sql`${reports.reporterUserId} = ${targetId} OR ${reports.reportedUserId} = ${targetId}`
          );
        if (userRideIds.length > 0) {
          await tx.delete(reports).where(inArray(reports.rideId, userRideIds));
        }

        await tx.delete(bookings).where(eq(bookings.passengerUserId, targetId));
        if (userRideIds.length > 0) {
          await tx.delete(bookings).where(inArray(bookings.rideId, userRideIds));
        }

        await tx.delete(rides).where(eq(rides.providerUserId, targetId));
        await tx.delete(rideSchedules).where(eq(rideSchedules.providerUserId, targetId));
        await tx.delete(vehicles).where(eq(vehicles.ownerUserId, targetId));
        await tx
          .delete(transportServices)
          .where(eq(transportServices.coordinatorUserId, targetId));
        await tx.delete(timetableSlots).where(eq(timetableSlots.userId, targetId));
        await tx.delete(notifications).where(eq(notifications.userId, targetId));
        await tx
          .delete(verificationRecords)
          .where(eq(verificationRecords.userId, targetId));
        await tx.delete(auditLogs).where(eq(auditLogs.adminUserId, targetId));

        await tx.delete(users).where(eq(users.id, targetId));
      });

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'USER_DELETED',
        targetType: 'user',
        targetId,
        details: `Deleted student record ${target.fullName} (${target.email}) and cascading data`,
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete user record';
      res.status(500).json({ error: msg });
    }
  });

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

        if (alsoVerifyOwnerCnic && ['verified', 'rejected', 'pending'].includes(verificationStatus)) {
          await db
            .update(users)
            .set({
              cnicVerificationStatus: verificationStatus,
              verificationReviewNote: cleanNote,
              updatedAt: new Date(),
            })
            .where(eq(users.id, updated.ownerUserId));

          await db
            .update(verificationRecords)
            .set({
              status: verificationStatus,
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

  // Admin: Delete vehicle record & uploaded CNIC image so user can re-upload clean info
  app.delete('/api/admin/vehicles/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const targetId = Number(req.params.id);
      const [vehicle] = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, targetId))
        .limit(1);
      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });

      await db.transaction(async (tx) => {
        await tx
          .update(rideSchedules)
          .set({ vehicleId: null, isActive: false })
          .where(eq(rideSchedules.vehicleId, targetId));
        await tx
          .update(rides)
          .set({ vehicleId: null })
          .where(eq(rides.vehicleId, targetId));
        await tx
          .delete(verificationRecords)
          .where(eq(verificationRecords.relatedVehicleId, targetId));
        await tx.delete(vehicles).where(eq(vehicles.id, targetId));
      });

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'VEHICLE_DELETED',
        targetType: 'vehicle',
        targetId,
        details: `Deleted vehicle ${vehicle.makeModel} (${vehicle.registrationNumber}) and its uploaded CNIC copy`,
      });

      await db.insert(notifications).values({
        userId: vehicle.ownerUserId,
        type: 'document_verification',
        title: `Vehicle ${vehicle.registrationNumber} Removed by Admin`,
        body: 'Admin removed your vehicle entry (blurry photo or wrong details). Upload your vehicle and CNIC again.',
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete vehicle';
      res.status(500).json({ error: msg });
    }
  });

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

        if (alsoVerifyOwnerCnic && ['verified', 'rejected', 'pending'].includes(verificationStatus)) {
          await db
            .update(users)
            .set({
              cnicVerificationStatus: verificationStatus,
              verificationReviewNote: cleanNote,
              updatedAt: new Date(),
            })
            .where(eq(users.id, updated.coordinatorUserId));

          await db
            .update(verificationRecords)
            .set({
              status: verificationStatus,
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

  // Admin: Delete carry/transport service & uploaded CNIC image so coordinator can re-upload
  app.delete('/api/admin/services/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const targetId = Number(req.params.id);
      const [service] = await db
        .select()
        .from(transportServices)
        .where(eq(transportServices.id, targetId))
        .limit(1);
      if (!service) {
        return res.status(404).json({ error: 'Transport service not found.' });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(rideSchedules)
          .set({ transportServiceId: null, isActive: false })
          .where(eq(rideSchedules.transportServiceId, targetId));
        await tx
          .update(rides)
          .set({ transportServiceId: null })
          .where(eq(rides.transportServiceId, targetId));
        await tx
          .delete(verificationRecords)
          .where(eq(verificationRecords.relatedServiceId, targetId));
        await tx.delete(transportServices).where(eq(transportServices.id, targetId));
      });

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'SERVICE_DELETED',
        targetType: 'transport_service',
        targetId,
        details: `Deleted carry service ${service.serviceName} (${service.registrationNumber}) and its uploaded CNIC copy`,
      });

      await db.insert(notifications).values({
        userId: service.coordinatorUserId,
        type: 'document_verification',
        title: `Carry Service ${service.serviceName} Removed by Admin`,
        body: 'Admin removed your carry service entry. Upload the driver details and CNIC photo again.',
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to delete transport service';
      res.status(500).json({ error: msg });
    }
  });

  // Admin: Delete a ride occurrence & cascading bookings/messages/locations/sos/challans
  app.delete('/api/admin/rides/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const rideId = Number(req.params.id);
      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      await db.transaction(async (tx) => {
        const rideMsgs = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.rideId, rideId));
        if (rideMsgs.length > 0) {
          await tx
            .delete(messageReactions)
            .where(
              inArray(
                messageReactions.messageId,
                rideMsgs.map((m) => m.id)
              )
            );
        }
        await tx.delete(messages).where(eq(messages.rideId, rideId));
        await tx.delete(reviews).where(eq(reviews.rideId, rideId));
        await tx.delete(rideChallans).where(eq(rideChallans.rideId, rideId));
        await tx.delete(sosAlerts).where(eq(sosAlerts.rideId, rideId));
        await tx.delete(liveLocations).where(eq(liveLocations.rideId, rideId));
        await tx.delete(reports).where(eq(reports.rideId, rideId));
        await tx.delete(bookings).where(eq(bookings.rideId, rideId));
        await tx.delete(rides).where(eq(rides.id, rideId));
      });

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'RIDE_DELETED',
        targetType: 'ride',
        targetId: rideId,
        details: `Deleted ride #${rideId} (${ride.originCity} → ${ride.destinationCity} on ${ride.travelDate})`,
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete ride';
      res.status(500).json({ error: msg });
    }
  });

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

  app.delete('/api/admin/reports/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) return res.status(403).json({ error: 'Admin access required.' });

      const targetId = Number(req.params.id);
      const [deleted] = await db
        .delete(reports)
        .where(eq(reports.id, targetId))
        .returning();
      if (!deleted) return res.status(404).json({ error: 'Report not found.' });

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'REPORT_DELETED',
        targetType: 'report',
        targetId,
        details: `Deleted report #${targetId} (${deleted.category})`,
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete report';
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

  app.delete('/api/admin/routes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      if (!admin.isAdmin) return res.status(403).json({ error: 'Admin access required.' });

      const routeId = Number(req.params.id);
      const [linkedRide] = await db
        .select({ id: rides.id })
        .from(rides)
        .where(eq(rides.routeId, routeId))
        .limit(1);

      if (linkedRide) {
        const [deactivated] = await db
          .update(routes)
          .set({ isActive: false })
          .where(eq(routes.id, routeId))
          .returning();
        if (!deactivated) return res.status(404).json({ error: 'Route not found.' });
        await db.insert(auditLogs).values({
          adminUserId: admin.id,
          action: 'ROUTE_DEACTIVATED',
          targetType: 'route',
          targetId: routeId,
          details: `Deactivated corridor ${deactivated.corridorLabel} (has existing rides)`,
        });
        return res.json({ ok: true, deactivated: true });
      }

      const [deleted] = await db
        .delete(routes)
        .where(eq(routes.id, routeId))
        .returning();
      if (!deleted) return res.status(404).json({ error: 'Route not found.' });

      await db.insert(auditLogs).values({
        adminUserId: admin.id,
        action: 'ROUTE_DELETED',
        targetType: 'route',
        targetId: routeId,
        details: `Deleted corridor ${deleted.corridorLabel}`,
      });
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete route';
      res.status(500).json({ error: msg });
    }
  });

  // Owner: Delete own unverified/rejected vehicle or carry service to re-submit cleanly
  app.delete('/api/vehicles/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const vehicleId = Number(req.params.id);
      const [vehicle] = await db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.ownerUserId, user.id)))
        .limit(1);
      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });

      await db.transaction(async (tx) => {
        await tx
          .update(rideSchedules)
          .set({ vehicleId: null, isActive: false })
          .where(eq(rideSchedules.vehicleId, vehicleId));
        await tx
          .update(rides)
          .set({ vehicleId: null })
          .where(eq(rides.vehicleId, vehicleId));
        await tx
          .delete(verificationRecords)
          .where(eq(verificationRecords.relatedVehicleId, vehicleId));
        await tx.delete(vehicles).where(eq(vehicles.id, vehicleId));
      });
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to remove vehicle';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/transport-services/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = await getOrCreateUser({
        uid: req.user!.uid,
        email: req.user!.email || '',
      });
      const serviceId = Number(req.params.id);
      const [service] = await db
        .select()
        .from(transportServices)
        .where(
          and(
            eq(transportServices.id, serviceId),
            eq(transportServices.coordinatorUserId, user.id)
          )
        )
        .limit(1);
      if (!service) {
        return res.status(404).json({ error: 'Transport service not found.' });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(rideSchedules)
          .set({ transportServiceId: null, isActive: false })
          .where(eq(rideSchedules.transportServiceId, serviceId));
        await tx
          .update(rides)
          .set({ transportServiceId: null })
          .where(eq(rides.transportServiceId, serviceId));
        await tx
          .delete(verificationRecords)
          .where(eq(verificationRecords.relatedServiceId, serviceId));
        await tx.delete(transportServices).where(eq(transportServices.id, serviceId));
      });
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to remove carry service';
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
