import { Router } from 'express';
import { count, eq } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../../src/db/index.ts';
import { ensureDatabaseSchema } from '../../src/db/bootstrapSchema.ts';
import { institutionMemberships, institutions, profiles } from '../../src/db/schema.ts';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import {
  bootstrapAdminSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginRequestSchema,
  registerStudentSchema,
  resetPasswordSchema,
} from '../../shared/schemas.ts';
import {
  generateOpaqueToken,
  hashPassword,
  hashSessionToken,
  signAuthToken,
  verifyPassword,
} from '../utils/crypto.ts';
import {
  createRateLimiter,
  isPrimaryHostEmail,
  requireAuth,
  type AuthRequest,
} from '../middleware/auth.ts';
import { recordAuditLog } from '../services/audit.ts';
import type { UserProfile, UserRole } from '../../shared/types.ts';

const router = Router();
const authRateLimit = createRateLimiter('auth', 25, 60_000);

async function getOrCreateDefaultInstitution() {
  await ensureDatabaseSchema();
  const existing = await db.select().from(institutions).limit(1);
  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(institutions)
    .values({
      name: 'ThinkPulse Academy',
      code: 'TP-MAIN',
      status: 'active',
      settings: {
        allowStudentSelfRegistration: true,
        defaultPrivacyMode: 'normal',
        graceWindowSeconds: 15,
      },
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;
  const retry = await db.select().from(institutions).limit(1);
  return retry[0];
}

function serializeProfile(
  p: typeof profiles.$inferSelect,
  institutionName?: string
): UserProfile {
  const primaryHost = isPrimaryHostEmail(p.email);
  return {
    id: p.id,
    email: p.email,
    displayName: p.displayName,
    role: primaryHost ? 'platform_admin' : 'student',
    serverAdmin: primaryHost,
    institutionId: p.institutionId,
    institutionName,
    studentCode: p.studentCode,
    classSection: p.classSection,
    department: p.department,
    notes: p.notes,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// Public status endpoint for institution metadata
router.get('/auth/bootstrap-status', async (_req, res) => {
  try {
    const inst = await getOrCreateDefaultInstitution();
    return res.json({
      needsAdminBootstrap: false,
      institutionName: inst.name,
      allowStudentSelfRegistration: inst.settings?.allowStudentSelfRegistration !== false,
    });
  } catch (err) {
    console.error('[auth] bootstrap-status error:', err);
    return res.status(500).json({ error: 'Unable to load institution configuration.' });
  }
});

// Restricted admin bootstrap: strictly allowlisted primary host emails only
router.post('/auth/bootstrap-admin', authRateLimit, async (req: AuthRequest, res) => {
  const parsed = bootstrapAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid setup details.',
      issues: parsed.error.issues,
    });
  }

  try {
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    if (!isPrimaryHostEmail(normalizedEmail)) {
      return res.status(403).json({
        error: 'Only authorized primary host accounts may claim administrator access.',
      });
    }

    const [{ totalAdmins }] = await db
      .select({ totalAdmins: count() })
      .from(profiles)
      .where(eq(profiles.role, 'platform_admin'));

    if (Number(totalAdmins) > 0) {
      return res.status(403).json({
        error: 'Institution administrator setup has already been completed. Sign in with Google.',
      });
    }

    const inst = await getOrCreateDefaultInstitution();

    const [updatedInst] = await db
      .update(institutions)
      .set({ name: parsed.data.institutionName.trim(), updatedAt: new Date() })
      .where(eq(institutions.id, inst.id))
      .returning();

    const passwordHash = hashPassword(parsed.data.password);
    const authUid = `local:${crypto.randomUUID()}`;

    const [createdProfile] = await db
      .insert(profiles)
      .values({
        authUid,
        email: normalizedEmail,
        passwordHash,
        displayName: parsed.data.displayName.trim(),
        institutionId: inst.id,
        role: 'platform_admin',
        serverAdmin: true,
        status: 'active',
      })
      .returning();

    await db
      .insert(institutionMemberships)
      .values({
        userId: createdProfile.id,
        institutionId: inst.id,
        membershipRole: 'platform_admin',
        status: 'active',
      })
      .onConflictDoNothing();

    await recordAuditLog({
      actorId: createdProfile.id,
      actorEmail: createdProfile.email,
      institutionId: inst.id,
      action: 'admin.bootstrap_completed',
      targetType: 'institution',
      targetId: inst.id,
      changedFields: ['institutionName', 'platform_admin'],
      metadata: { institutionName: updatedInst.name },
    });

    const token = signAuthToken({
      sub: createdProfile.id,
      email: createdProfile.email,
      role: 'platform_admin',
      inst: createdProfile.institutionId,
    });

    return res.status(201).json({
      token,
      profile: serializeProfile(createdProfile, updatedInst.name),
    });
  } catch (err: unknown) {
    console.error('[auth] bootstrap-admin error:', err);
    return res.status(500).json({ error: 'Could not complete administrator setup. Email may already be in use.' });
  }
});

// Unified Email/Password login: role determined strictly server-side from credentials
router.post('/auth/login', authRateLimit, async (req: AuthRequest, res) => {
  const parsed = loginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid credentials format.',
    });
  }

  try {
    const email = parsed.data.email.trim().toLowerCase();
    const rows = await db
      .select({ profile: profiles, institutionName: institutions.name })
      .from(profiles)
      .innerJoin(institutions, eq(profiles.institutionId, institutions.id))
      .where(eq(profiles.email, email))
      .limit(1);

    const record = rows[0];
    if (!record || !verifyPassword(parsed.data.password, record.profile.passwordHash)) {
      return res.status(401).json({
        error: 'Invalid email address or password.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (record.profile.status !== 'active') {
      return res.status(403).json({
        error: 'This account is suspended. Contact your institution administrator.',
      });
    }

    const primaryHost = isPrimaryHostEmail(record.profile.email);
    const resolvedRole: UserRole = primaryHost ? 'platform_admin' : 'student';
    let syncedProfile = record.profile;

    if (syncedProfile.role !== resolvedRole || syncedProfile.serverAdmin !== primaryHost) {
      const [updated] = await db
        .update(profiles)
        .set({
          role: resolvedRole,
          serverAdmin: primaryHost,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, syncedProfile.id))
        .returning();
      if (updated) syncedProfile = updated;
    }

    const token = signAuthToken({
      sub: syncedProfile.id,
      email: syncedProfile.email,
      role: resolvedRole,
      inst: syncedProfile.institutionId,
    });

    return res.json({
      token,
      profile: serializeProfile(syncedProfile, record.institutionName),
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ error: 'Sign-in failed. Please try again.' });
  }
});

// Unified Google Sign-In via Firebase ID Token: role identified strictly from authenticated email
router.post('/auth/google', authRateLimit, async (req: AuthRequest, res) => {
  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid Google sign-in token.' });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(parsed.data.idToken);
  } catch (err) {
    console.error('[auth] google token verification error:', err);
    return res.status(401).json({ error: 'Google sign-in token verification failed. Please try again.' });
  }

  try {
    const email = (decoded.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Google account did not return an email address.' });
    }

    const primaryHost = isPrimaryHostEmail(email);
    const resolvedRole: UserRole = primaryHost ? 'platform_admin' : 'student';

    const inst = await getOrCreateDefaultInstitution();
    const existingRows = await db
      .select({ profile: profiles, institutionName: institutions.name })
      .from(profiles)
      .innerJoin(institutions, eq(profiles.institutionId, institutions.id))
      .where(eq(profiles.email, email))
      .limit(1);

    let profile = existingRows[0]?.profile;
    let institutionName = existingRows[0]?.institutionName || inst.name;

    if (!profile) {
      if (!primaryHost && inst.settings?.allowStudentSelfRegistration === false) {
        return res.status(403).json({
          error: 'New registrations require an institution invitation. Contact your administrator.',
        });
      }

      const [created] = await db
        .insert(profiles)
        .values({
          authUid: decoded.uid,
          email,
          displayName: decoded.name || email.split('@')[0],
          institutionId: inst.id,
          role: resolvedRole,
          serverAdmin: primaryHost,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: profiles.email,
          set: {
            authUid: decoded.uid,
            role: resolvedRole,
            serverAdmin: primaryHost,
            updatedAt: new Date(),
          },
        })
        .returning();

      await db
        .insert(institutionMemberships)
        .values({
          userId: created.id,
          institutionId: inst.id,
          membershipRole: resolvedRole,
          status: 'active',
        })
        .onConflictDoNothing();

      profile = created;
      institutionName = inst.name;
    } else if (
      profile.authUid !== decoded.uid ||
      profile.role !== resolvedRole ||
      profile.serverAdmin !== primaryHost
    ) {
      const [updated] = await db
        .update(profiles)
        .set({
          authUid: decoded.uid,
          role: resolvedRole,
          serverAdmin: primaryHost,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profile.id))
        .returning();
      profile = updated;

      await db
        .update(institutionMemberships)
        .set({ membershipRole: resolvedRole })
        .where(eq(institutionMemberships.userId, profile.id));
    }

    if (profile.status !== 'active') {
      return res.status(403).json({
        error: 'This account is suspended. Contact your institution administrator.',
      });
    }

    const token = signAuthToken({
      sub: profile.id,
      email: profile.email,
      role: resolvedRole,
      inst: profile.institutionId,
    });

    return res.json({
      token,
      profile: serializeProfile(profile, institutionName),
    });
  } catch (err) {
    console.error('[auth] google login database error:', err);
    return res.status(500).json({ error: 'Unable to complete Google sign-in right now. Please try again.' });
  }
});

// Institution-configurable Student self-registration (NEVER allows host or platform_admin role)
router.post('/auth/register-student', authRateLimit, async (req: AuthRequest, res) => {
  const parsed = registerStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Please check your registration details.',
    });
  }

  try {
    const inst = await getOrCreateDefaultInstitution();
    if (inst.settings?.allowStudentSelfRegistration === false) {
      return res.status(403).json({
        error: 'Student self-registration is disabled by your institution. Contact your administrator.',
      });
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({
        error: 'An account with this email address already exists. Please sign in instead.',
      });
    }

    const [created] = await db
      .insert(profiles)
      .values({
        authUid: `local:${crypto.randomUUID()}`,
        email: normalizedEmail,
        passwordHash: hashPassword(parsed.data.password),
        displayName: parsed.data.displayName.trim(),
        institutionId: inst.id,
        role: 'student', // Hardcoded server-side; client can NEVER self-assign Host/Admin
        serverAdmin: false,
        classSection: parsed.data.classSection?.trim() || null,
        studentCode: parsed.data.studentCode?.trim() || `STU-${crypto.randomInt(10000, 99999)}`,
        status: 'active',
      })
      .returning();

    await db
      .insert(institutionMemberships)
      .values({
        userId: created.id,
        institutionId: inst.id,
        membershipRole: 'student',
        status: 'active',
      })
      .onConflictDoNothing();

    await recordAuditLog({
      actorId: created.id,
      actorEmail: created.email,
      institutionId: inst.id,
      action: 'student.self_registered',
      targetType: 'student',
      targetId: created.id,
      changedFields: ['displayName', 'classSection'],
      metadata: { role: 'student' },
    });

    const token = signAuthToken({
      sub: created.id,
      email: created.email,
      role: 'student',
      inst: created.institutionId,
    });

    return res.status(201).json({
      token,
      profile: serializeProfile(created, inst.name),
    });
  } catch (err) {
    console.error('[auth] register-student error:', err);
    return res.status(500).json({ error: 'Unable to register student account right now.' });
  }
});

// Password recovery request
router.post('/auth/forgot-password', authRateLimit, async (req: AuthRequest, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  try {
    const email = parsed.data.email.trim().toLowerCase();
    const [found] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);

    // Always return non-enumerating generic response for security
    let devRecoveryToken: string | undefined;
    if (found && found.passwordHash) {
      const rawResetToken = generateOpaqueToken(18);
      const tokenHash = hashSessionToken(rawResetToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await db
        .update(profiles)
        .set({
          resetTokenHash: tokenHash,
          resetTokenExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, found.id));

      // Only return inline token if no mail provider is configured (clearly labelled development recovery)
      if (!process.env.MAIL_PROVIDER) {
        devRecoveryToken = rawResetToken;
      }
    }

    return res.json({
      message:
        'If an email/password account matches that address, password recovery instructions have been issued.',
      ...(devRecoveryToken
        ? {
            mailProviderConfigured: false,
            devResetToken: devRecoveryToken,
          }
        : { mailProviderConfigured: Boolean(process.env.MAIL_PROVIDER) }),
    });
  } catch (err) {
    console.error('[auth] forgot-password error:', err);
    return res.status(500).json({ error: 'Unable to process password recovery request.' });
  }
});

router.post('/auth/reset-password', authRateLimit, async (req: AuthRequest, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid password reset request.' });
  }

  try {
    const email = parsed.data.email.trim().toLowerCase();
    const [found] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
    const suppliedHash = hashSessionToken(parsed.data.token.trim());

    if (
      !found ||
      !found.resetTokenHash ||
      !found.resetTokenExpiresAt ||
      found.resetTokenExpiresAt.getTime() < Date.now() ||
      found.resetTokenHash !== suppliedHash
    ) {
      return res.status(400).json({ error: 'Recovery token is invalid or has expired.' });
    }

    await db
      .update(profiles)
      .set({
        passwordHash: hashPassword(parsed.data.newPassword),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, found.id));

    return res.json({ message: 'Your password has been updated. You can now sign in.' });
  } catch (err) {
    console.error('[auth] reset-password error:', err);
    return res.status(500).json({ error: 'Password reset failed.' });
  }
});

router.post('/auth/logout', (_req, res) => {
  return res.json({ ok: true });
});

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({ profile: profiles, institutionName: institutions.name })
      .from(profiles)
      .innerJoin(institutions, eq(profiles.institutionId, institutions.id))
      .where(eq(profiles.id, req.currentUser!.id))
      .limit(1);

    if (!rows[0]) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    return res.json({ profile: serializeProfile(rows[0].profile, rows[0].institutionName) });
  } catch (err) {
    console.error('[auth] /me error:', err);
    return res.status(500).json({ error: 'Failed to load user profile.' });
  }
});

export default router;
