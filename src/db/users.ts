import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { campuses, notifications, universities, users } from './schema.ts';
import { ensureSeeded } from './seed.ts';

export const SUPER_ADMIN_EMAILS = new Set([
  'bakarrkhann@gmail.com',
  'haider.hamid3050@gmail.com',
]);

export function isSuperAdminEmail(email?: string | null): boolean {
  return SUPER_ADMIN_EMAILS.has((email || '').toLowerCase().trim());
}

export async function getOrCreateUser(params: {
  uid: string;
  email: string;
  fullName?: string | null;
}) {
  try {
    await ensureSeeded();

    const normalizedEmail = params.email.toLowerCase().trim();
    const isSuperAdmin = isSuperAdminEmail(normalizedEmail);
    const isNuEmail =
      normalizedEmail.endsWith('@nu.edu.pk') ||
      normalizedEmail.endsWith('@cfd.nu.edu.pk');

    const [defaultUni] = await db.select().from(universities).limit(1);
    const [defaultCampus] = await db.select().from(campuses).limit(1);

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.uid, params.uid))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(users)
        .set({
          email: params.email,
          isAdmin: isSuperAdmin ? true : existing[0].isAdmin,
          updatedAt: new Date(),
        })
        .where(eq(users.uid, params.uid))
        .returning();
      return {
        ...updated,
        isSuperAdmin,
      };
    }

    const displayName =
      params.fullName?.trim() || params.email.split('@')[0] || 'FAST Student';

    const result = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        fullName: displayName,
        nuEmail: isNuEmail ? normalizedEmail : null,
        universityId: defaultUni?.id ?? null,
        campusId: defaultCampus?.id ?? null,
        verificationStatus: isSuperAdmin || isNuEmail ? 'verified' : 'pending',
        cnicVerificationStatus: isSuperAdmin ? 'verified' : 'unsubmitted',
        studentCardStatus: isSuperAdmin ? 'verified' : 'unsubmitted',
        isAdmin: isSuperAdmin,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          ...(isSuperAdmin
            ? {
                isAdmin: true,
                verificationStatus: 'verified',
                cnicVerificationStatus: 'verified',
                studentCardStatus: 'verified',
              }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    const createdUser = result[0];

    await db.insert(notifications).values({
      userId: createdUser.id,
      type: 'welcome',
      title: 'Welcome to NUCESPOOL',
      body:
        createdUser.verificationStatus === 'verified'
          ? 'Your FAST-NUCES Chiniot account is verified and ready for ride booking.'
          : 'Complete your FAST-NUCES student verification details to unlock booking and ride publishing.',
    });

    return {
      ...createdUser,
      isSuperAdmin,
    };
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user profile.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in getUserByUid:', error);
    throw new Error('Failed to load user record.', { cause: error });
  }
}
