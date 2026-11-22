import { Router } from 'express';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { db } from '../../src/db/index.ts';
import {
  answers,
  assessments,
  auditLogs,
  gradingRecords,
  institutionMemberships,
  institutions,
  profiles,
  questionOptions,
  questions,
  sessions,
  studentPrivateSessionClaims,
  submissions,
} from '../../src/db/schema.ts';
import {
  addHostSchema,
  createAssessmentSchema,
  createStudentByHostSchema,
  extendSessionSchema,
  gradeSubmissionSchema,
  launchSessionSchema,
  recalculateSchema,
  removeHostSchema,
  updateSettingsSchema,
  updateStudentProfileSchema,
} from '../../shared/schemas.ts';
import {
  aggregatePollResults,
  buildOfficialQrPayload,
  buildPollCsvExport,
  computeEffectiveSessionStatus,
  computeRemainingSeconds,
  computeSubmissionTotals,
  gradeObjectiveQuestion,
} from '../services/domain.ts';
import {
  generateQrToken,
  generateSixDigitCode,
  hashPassword,
  hashQrToken,
} from '../utils/crypto.ts';
import {
  createRateLimiter,
  isPrimaryHostEmail,
  PRIMARY_HOST_EMAILS,
  requireAuth,
  requireHost,
  type AuthRequest,
} from '../middleware/auth.ts';
import { recordAuditLog } from '../services/audit.ts';
import { publishRealtimeEvent } from '../realtime/bus.ts';
import type {
  AddedHostEntry,
  AssessmentDTO,
  AssessmentStatus,
  AssessmentType,
  AuditLogDTO,
  GradingOutcome,
  HostAccessRecordDTO,
  HostOverviewDTO,
  PrivacyMode,
  QuestionDTO,
  QuestionType,
  QuizAnalyticsDTO,
  SessionDTO,
  SessionStatus,
  StudentRetrievalResultDTO,
  SubmissionDetailDTO,
  SubmissionStatus,
  SubmissionSummaryDTO,
  UserProfile,
  UserRole,
} from '../../shared/types.ts';

const router = Router();
const emailSearchRateLimit = createRateLimiter('email-search', 30, 60_000);
const hostManageRateLimit = createRateLimiter('host-manage', 25, 60_000);

router.use('/host', requireAuth, requireHost);

async function serializeSessionForHost(
  s: typeof sessions.$inferSelect,
  extras?: { assessmentTitle?: string; assessmentType?: AssessmentType; submissionCount?: number }
): Promise<SessionDTO> {
  const now = new Date();
  const effectiveStatus = computeEffectiveSessionStatus(s.status, s.expiresAt, now);
  const qrPayload = buildOfficialQrPayload(s.id, s.qrTokenRaw);
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    width: 720,
    margin: 2,
    color: { dark: '#17143A', light: '#FFFFFF' },
  });

  return {
    id: s.id,
    assessmentId: s.assessmentId,
    assessmentTitle: extras?.assessmentTitle,
    assessmentType: extras?.assessmentType,
    joinCode: s.joinCode,
    qrTokenRaw: s.qrTokenRaw,
    qrPayload,
    qrDataUrl,
    qrVersion: s.qrVersion,
    privacyMode: s.privacyMode as PrivacyMode,
    status: s.status as SessionStatus,
    effectiveStatus,
    durationMinutes: s.durationMinutes,
    launchedAt: s.launchedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    remainingSeconds: effectiveStatus === 'active' ? computeRemainingSeconds(s.expiresAt, now) : 0,
    submissionCount: extras?.submissionCount ?? 0,
  };
}

function serializeAudit(a: typeof auditLogs.$inferSelect): AuditLogDTO {
  return {
    id: a.id,
    actorId: a.actorId,
    actorEmail: a.actorEmail,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    changedFields: a.changedFields ?? [],
    metadata: a.metadata ?? {},
    createdAt: a.createdAt.toISOString(),
  };
}

async function generateCollisionSafeSixDigitCode(institutionId: string): Promise<string> {
  const now = new Date();
  const activeSessions = await db
    .select({ joinCode: sessions.joinCode, status: sessions.status, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.institutionId, institutionId), eq(sessions.status, 'active')));

  const activeCodes = new Set(
    activeSessions
      .filter((s) => computeEffectiveSessionStatus(s.status, s.expiresAt, now) === 'active')
      .map((s) => s.joinCode)
  );

  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = generateSixDigitCode();
    if (!activeCodes.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique six-digit code. Please retry.');
}

// ============================================================================
// 1. HOST OVERVIEW (Real PostgreSQL aggregates — never fetches unbounded rows)
// ============================================================================
router.get('/host/overview', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const now = new Date();

    const [
      [{ totalStudents }],
      [{ totalQuizzes }],
      [{ totalPolls }],
      [{ totalSubmissions }],
      [{ pendingReviews }],
      activeSessionRows,
      recentAuditRows,
    ] = await Promise.all([
      db
        .select({ totalStudents: count() })
        .from(profiles)
        .where(and(eq(profiles.institutionId, instId), eq(profiles.role, 'student'))),
      db
        .select({ totalQuizzes: count() })
        .from(assessments)
        .where(and(eq(assessments.institutionId, instId), eq(assessments.type, 'quiz'))),
      db
        .select({ totalPolls: count() })
        .from(assessments)
        .where(and(eq(assessments.institutionId, instId), eq(assessments.type, 'poll'))),
      db
        .select({ totalSubmissions: count() })
        .from(submissions)
        .where(eq(submissions.institutionId, instId)),
      db
        .select({ pendingReviews: count() })
        .from(submissions)
        .where(and(eq(submissions.institutionId, instId), eq(submissions.status, 'pending_review'))),
      db
        .select({
          session: sessions,
          assessmentTitle: assessments.title,
          assessmentType: assessments.type,
        })
        .from(sessions)
        .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
        .where(and(eq(sessions.institutionId, instId), eq(sessions.status, 'active')))
        .orderBy(desc(sessions.launchedAt))
        .limit(12),
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.institutionId, instId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(10),
    ]);

    const trulyActive = activeSessionRows.filter(
      (r) => computeEffectiveSessionStatus(r.session.status, r.session.expiresAt, now) === 'active'
    );

    const activeIds = trulyActive.map((r) => r.session.id);
    const subCounts = activeIds.length
      ? await db
          .select({ sessionId: submissions.sessionId, cnt: count() })
          .from(submissions)
          .where(inArray(submissions.sessionId, activeIds))
          .groupBy(submissions.sessionId)
      : [];
    const subCountMap = new Map(subCounts.map((c) => [c.sessionId, Number(c.cnt)]));

    const activeSessionsList = await Promise.all(
      trulyActive.map((r) =>
        serializeSessionForHost(r.session, {
          assessmentTitle: r.assessmentTitle,
          assessmentType: r.assessmentType as AssessmentType,
          submissionCount: subCountMap.get(r.session.id) ?? 0,
        })
      )
    );

    const payload: HostOverviewDTO = {
      metrics: {
        totalStudents: Number(totalStudents),
        totalQuizzes: Number(totalQuizzes),
        totalPolls: Number(totalPolls),
        activeSessions: activeSessionsList.length,
        totalSubmissions: Number(totalSubmissions),
        pendingReviews: Number(pendingReviews),
      },
      activeSessionsList,
      recentActivity: recentAuditRows.map(serializeAudit),
    };

    return res.json(payload);
  } catch (err) {
    console.error('[host] overview error:', err);
    return res.status(500).json({ error: 'Unable to load Host Command Centre overview.' });
  }
});

// ============================================================================
// 2. ASSESSMENTS CRUD (Quiz Generator & Poll Generator)
// ============================================================================
router.get('/host/assessments', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const typeFilter = req.query.type === 'quiz' || req.query.type === 'poll' ? req.query.type : null;
    const statusFilter =
      req.query.status === 'draft' || req.query.status === 'active' || req.query.status === 'expired'
        ? req.query.status
        : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const conditions = [eq(assessments.institutionId, instId)];
    if (typeFilter) conditions.push(eq(assessments.type, typeFilter));
    if (statusFilter) conditions.push(eq(assessments.status, statusFilter));
    if (search) conditions.push(ilike(assessments.title, `%${search}%`));

    const rows = await db
      .select()
      .from(assessments)
      .where(and(...conditions))
      .orderBy(desc(assessments.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(assessments)
      .where(and(...conditions));

    const ids = rows.map((r) => r.id);
    const [qStats, subStats, pendingStats, activeSessions] = ids.length
      ? await Promise.all([
          db
            .select({
              assessmentId: questions.assessmentId,
              qCount: count(),
              totalPoints: sql<number>`coalesce(sum(${questions.points}), 0)`,
            })
            .from(questions)
            .where(inArray(questions.assessmentId, ids))
            .groupBy(questions.assessmentId),
          db
            .select({ assessmentId: submissions.assessmentId, cnt: count() })
            .from(submissions)
            .where(inArray(submissions.assessmentId, ids))
            .groupBy(submissions.assessmentId),
          db
            .select({ assessmentId: submissions.assessmentId, cnt: count() })
            .from(submissions)
            .where(and(inArray(submissions.assessmentId, ids), eq(submissions.status, 'pending_review')))
            .groupBy(submissions.assessmentId),
          db
            .select()
            .from(sessions)
            .where(and(inArray(sessions.assessmentId, ids), eq(sessions.status, 'active')))
            .orderBy(desc(sessions.launchedAt)),
        ])
      : [[], [], [], []];

    const qStatMap = new Map(qStats.map((x) => [x.assessmentId, { qCount: Number(x.qCount), totalPoints: Number(x.totalPoints) }]));
    const subMap = new Map(subStats.map((x) => [x.assessmentId, Number(x.cnt)]));
    const pendMap = new Map(pendingStats.map((x) => [x.assessmentId, Number(x.cnt)]));
    const activeSessMap = new Map<string, typeof sessions.$inferSelect>();
    const now = new Date();
    for (const s of activeSessions) {
      if (!activeSessMap.has(s.assessmentId) && computeEffectiveSessionStatus(s.status, s.expiresAt, now) === 'active') {
        activeSessMap.set(s.assessmentId, s);
      }
    }

    const items: AssessmentDTO[] = await Promise.all(
      rows.map(async (r) => {
        const activeSess = activeSessMap.get(r.id);
        const subCount = subMap.get(r.id) ?? 0;
        const effectiveAssessmentStatus: AssessmentStatus = activeSess
          ? 'active'
          : r.status === 'active'
          ? 'expired'
          : (r.status as AssessmentStatus);

        return {
          id: r.id,
          hostId: r.hostId,
          institutionId: r.institutionId,
          type: r.type as AssessmentType,
          title: r.title,
          description: r.description,
          instructions: r.instructions,
          status: effectiveAssessmentStatus,
          privacyMode: r.privacyMode as PrivacyMode,
          durationMinutes: r.durationMinutes,
          settings: r.settings ?? {},
          activeSessionId: activeSess?.id ?? null,
          questionCount: qStatMap.get(r.id)?.qCount ?? 0,
          totalPoints: r.type === 'quiz' ? qStatMap.get(r.id)?.totalPoints ?? 0 : 0,
          submissionCount: subCount,
          pendingReviewCount: pendMap.get(r.id) ?? 0,
          privacyLocked: subCount > 0,
          activeSession: activeSess
            ? await serializeSessionForHost(activeSess, {
                assessmentTitle: r.title,
                assessmentType: r.type as AssessmentType,
                submissionCount: subCount,
              })
            : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      })
    );

    return res.json({ assessments: items, total: Number(total), limit, offset });
  } catch (err) {
    console.error('[host] list assessments error:', err);
    return res.status(500).json({ error: 'Unable to load assessments.' });
  }
});

router.get('/host/assessments/:id', async (req: AuthRequest, res) => {
  try {
    const [a] = await db
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.id, req.params.id),
          eq(assessments.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!a) return res.status(404).json({ error: 'Assessment not found.' });

    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, a.id))
      .orderBy(questions.position);
    const qIds = qRows.map((q) => q.id);

    const optRows = qIds.length
      ? await db
          .select()
          .from(questionOptions)
          .where(inArray(questionOptions.questionId, qIds))
          .orderBy(questionOptions.position)
      : [];

    const [{ subCount }] = await db
      .select({ subCount: count() })
      .from(submissions)
      .where(eq(submissions.assessmentId, a.id));

    const activeSessRows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.assessmentId, a.id), eq(sessions.status, 'active')))
      .orderBy(desc(sessions.launchedAt))
      .limit(1);

    const now = new Date();
    const activeSess =
      activeSessRows[0] && computeEffectiveSessionStatus(activeSessRows[0].status, activeSessRows[0].expiresAt, now) === 'active'
        ? activeSessRows[0]
        : null;

    const optMap = new Map<string, Array<typeof questionOptions.$inferSelect>>();
    for (const o of optRows) {
      const list = optMap.get(o.questionId) ?? [];
      list.push(o);
      optMap.set(o.questionId, list);
    }

    const dto: AssessmentDTO = {
      id: a.id,
      hostId: a.hostId,
      institutionId: a.institutionId,
      type: a.type as AssessmentType,
      title: a.title,
      description: a.description,
      instructions: a.instructions,
      status: activeSess ? 'active' : a.status === 'active' ? 'expired' : (a.status as AssessmentStatus),
      privacyMode: a.privacyMode as PrivacyMode,
      durationMinutes: a.durationMinutes,
      settings: a.settings ?? {},
      activeSessionId: activeSess?.id ?? null,
      questionCount: qRows.length,
      totalPoints: a.type === 'quiz' ? qRows.reduce((acc, q) => acc + q.points, 0) : 0,
      submissionCount: Number(subCount),
      privacyLocked: Number(subCount) > 0,
      activeSession: activeSess
        ? await serializeSessionForHost(activeSess, {
            assessmentTitle: a.title,
            assessmentType: a.type as AssessmentType,
            submissionCount: Number(subCount),
          })
        : null,
      questions: qRows.map((q) => ({
        id: q.id,
        position: q.position,
        type: q.type as QuestionType,
        text: q.text,
        points: a.type === 'quiz' ? q.points : 0,
        rubric: a.type === 'quiz' ? q.rubric : null,
        settings: q.settings ?? { partialCredit: false, required: true },
        options: (optMap.get(q.id) ?? []).map((o) => ({
          id: o.id,
          position: o.position,
          label: o.label,
          isCorrect: a.type === 'quiz' ? o.isCorrect : false,
        })),
      })),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };

    return res.json({ assessment: dto });
  } catch (err) {
    console.error('[host] get assessment error:', err);
    return res.status(500).json({ error: 'Unable to load assessment.' });
  }
});

router.post('/host/assessments', async (req: AuthRequest, res) => {
  const parsed = createAssessmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Validation failed.',
      issues: parsed.error.issues,
    });
  }

  try {
    const data = parsed.data;
    const createdId = await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(assessments)
        .values({
          hostId: req.currentUser!.id,
          institutionId: req.currentUser!.institutionId,
          type: data.type,
          title: data.title,
          description: data.description,
          instructions: data.instructions,
          status: 'draft',
          privacyMode: data.privacyMode,
          durationMinutes: data.durationMinutes,
          settings: data.settings,
        })
        .returning();

      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i];
        const [createdQ] = await tx
          .insert(questions)
          .values({
            assessmentId: a.id,
            position: i,
            type: q.type,
            text: q.text,
            points: data.type === 'quiz' ? q.points : 0,
            rubric: data.type === 'quiz' ? q.rubric ?? null : null,
            settings: q.settings,
          })
          .returning();

        if ((q.type === 'mcq' || q.type === 'multi_select') && q.options.length > 0) {
          await tx.insert(questionOptions).values(
            q.options.map((o, oIdx) => ({
              questionId: createdQ.id,
              position: oIdx,
              label: o.label,
              isCorrect: data.type === 'quiz' ? Boolean(o.isCorrect) : false,
            }))
          );
        }
      }
      return a.id;
    });

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: `${data.type}.created`,
      targetType: 'assessment',
      targetId: createdId,
      changedFields: ['title', 'privacyMode', 'questions'],
      metadata: { title: data.title, type: data.type, privacyMode: data.privacyMode, questionCount: data.questions.length },
    });

    return res.status(201).json({ id: createdId });
  } catch (err) {
    console.error('[host] create assessment error:', err);
    return res.status(500).json({ error: 'Unable to save assessment.' });
  }
});

router.patch('/host/assessments/:id', async (req: AuthRequest, res) => {
  const parsed = createAssessmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Validation failed.',
      issues: parsed.error.issues,
    });
  }

  try {
    const [existing] = await db
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.id, req.params.id),
          eq(assessments.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: 'Assessment not found.' });
    if (existing.type !== parsed.data.type) {
      return res.status(400).json({ error: 'Assessment type (quiz vs poll) cannot be changed after creation.' });
    }

    const [{ subCount }] = await db
      .select({ subCount: count() })
      .from(submissions)
      .where(eq(submissions.assessmentId, existing.id));

    // PRIVACY INVARIANT: Privacy mode is immutable after the first valid submission!
    if (Number(subCount) > 0 && parsed.data.privacyMode !== existing.privacyMode) {
      return res.status(409).json({
        error:
          'Privacy mode is locked after the first submission. Duplicate this assessment as a new draft if you need a different privacy mode.',
        code: 'PRIVACY_MODE_LOCKED',
      });
    }

    const data = parsed.data;
    let answerKeyChanged = false;

    await db.transaction(async (tx) => {
      await tx
        .update(assessments)
        .set({
          title: data.title,
          description: data.description,
          instructions: data.instructions,
          privacyMode: data.privacyMode,
          durationMinutes: data.durationMinutes,
          settings: data.settings,
          updatedAt: new Date(),
        })
        .where(eq(assessments.id, existing.id));

      // Preserve existing question & option UUIDs whenever provided so existing submissions stay linked for answer-key recalculation!
      const existingQuestions = await tx
        .select()
        .from(questions)
        .where(eq(questions.assessmentId, existing.id));
      const existingQMap = new Map(existingQuestions.map((q) => [q.id, q]));
      const keptQIds = new Set<string>();

      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i];
        let qId: string;

        if (q.id && existingQMap.has(q.id)) {
          qId = q.id;
          keptQIds.add(qId);
          const prevQ = existingQMap.get(qId)!;
          if (prevQ.points !== (data.type === 'quiz' ? q.points : 0) || prevQ.rubric !== (q.rubric ?? null)) {
            answerKeyChanged = true;
          }
          await tx
            .update(questions)
            .set({
              position: i,
              type: q.type,
              text: q.text,
              points: data.type === 'quiz' ? q.points : 0,
              rubric: data.type === 'quiz' ? q.rubric ?? null : null,
              settings: q.settings,
              updatedAt: new Date(),
            })
            .where(eq(questions.id, qId));
        } else {
          const [inserted] = await tx
            .insert(questions)
            .values({
              assessmentId: existing.id,
              position: i,
              type: q.type,
              text: q.text,
              points: data.type === 'quiz' ? q.points : 0,
              rubric: data.type === 'quiz' ? q.rubric ?? null : null,
              settings: q.settings,
            })
            .returning();
          qId = inserted.id;
          keptQIds.add(qId);
        }

        // Sync options preserving UUIDs where supplied
        if (q.type === 'mcq' || q.type === 'multi_select') {
          const existingOpts = await tx
            .select()
            .from(questionOptions)
            .where(eq(questionOptions.questionId, qId));
          const existingOptMap = new Map(existingOpts.map((o) => [o.id, o]));
          const keptOptIds = new Set<string>();

          for (let oi = 0; oi < q.options.length; oi++) {
            const opt = q.options[oi];
            const isCorrect = data.type === 'quiz' ? Boolean(opt.isCorrect) : false;
            if (opt.id && existingOptMap.has(opt.id)) {
              keptOptIds.add(opt.id);
              if (existingOptMap.get(opt.id)!.isCorrect !== isCorrect) {
                answerKeyChanged = true;
              }
              await tx
                .update(questionOptions)
                .set({ position: oi, label: opt.label, isCorrect })
                .where(eq(questionOptions.id, opt.id));
            } else {
              const [insOpt] = await tx
                .insert(questionOptions)
                .values({ questionId: qId, position: oi, label: opt.label, isCorrect })
                .returning();
              keptOptIds.add(insOpt.id);
              answerKeyChanged = true;
            }
          }

          // Remove deleted options only if not referenced or safe to remove
          for (const oldOpt of existingOpts) {
            if (!keptOptIds.has(oldOpt.id)) {
              await tx.delete(questionOptions).where(eq(questionOptions.id, oldOpt.id));
              answerKeyChanged = true;
            }
          }
        }
      }

      // Remove deleted questions if there are no submissions yet
      if (Number(subCount) === 0) {
        for (const oldQ of existingQuestions) {
          if (!keptQIds.has(oldQ.id)) {
            await tx.delete(questions).where(eq(questions.id, oldQ.id));
          }
        }
      }
    });

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: `${data.type}.updated`,
      targetType: 'assessment',
      targetId: existing.id,
      changedFields: ['title', 'questions', ...(answerKeyChanged ? ['answer_key'] : [])],
      metadata: {
        title: data.title,
        answerKeyChanged,
        existingSubmissionsCount: Number(subCount),
      },
    });

    return res.json({
      id: existing.id,
      answerKeyChanged,
      recalculationRecommended: data.type === 'quiz' && answerKeyChanged && Number(subCount) > 0,
    });
  } catch (err) {
    console.error('[host] update assessment error:', err);
    return res.status(500).json({ error: 'Unable to update assessment.' });
  }
});

router.post('/host/assessments/:id/duplicate', async (req: AuthRequest, res) => {
  try {
    const [orig] = await db
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.id, req.params.id),
          eq(assessments.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!orig) return res.status(404).json({ error: 'Assessment not found.' });

    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, orig.id))
      .orderBy(questions.position);
    const optRows = qRows.length
      ? await db
          .select()
          .from(questionOptions)
          .where(inArray(questionOptions.questionId, qRows.map((q) => q.id)))
          .orderBy(questionOptions.position)
      : [];

    const newId = await db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(assessments)
        .values({
          hostId: req.currentUser!.id,
          institutionId: req.currentUser!.institutionId,
          type: orig.type,
          title: `${orig.title} (Copy)`,
          description: orig.description,
          instructions: orig.instructions,
          status: 'draft',
          privacyMode: orig.privacyMode,
          durationMinutes: orig.durationMinutes,
          settings: orig.settings,
        })
        .returning();

      for (const q of qRows) {
        const [newQ] = await tx
          .insert(questions)
          .values({
            assessmentId: copy.id,
            position: q.position,
            type: q.type,
            text: q.text,
            points: q.points,
            rubric: q.rubric,
            settings: q.settings,
          })
          .returning();

        const opts = optRows.filter((o) => o.questionId === q.id);
        if (opts.length) {
          await tx.insert(questionOptions).values(
            opts.map((o) => ({
              questionId: newQ.id,
              position: o.position,
              label: o.label,
              isCorrect: o.isCorrect,
            }))
          );
        }
      }
      return copy.id;
    });

    return res.status(201).json({ id: newId });
  } catch (err) {
    console.error('[host] duplicate assessment error:', err);
    return res.status(500).json({ error: 'Unable to duplicate assessment.' });
  }
});

router.delete('/host/assessments/:id', async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.id, req.params.id),
          eq(assessments.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: 'Assessment not found.' });

    await db.delete(assessments).where(eq(assessments.id, existing.id));

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: `${existing.type}.deleted`,
      targetType: 'assessment',
      targetId: existing.id,
      metadata: { title: existing.title },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[host] delete assessment error:', err);
    return res.status(500).json({ error: 'Unable to delete assessment.' });
  }
});

// ============================================================================
// 3. LAUNCH & SESSION LIFECYCLE (6-digit numeric code, QR rotation, extend, end)
// ============================================================================
router.post('/host/assessments/:id/launch', async (req: AuthRequest, res) => {
  const parsed = launchSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid launch duration.' });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const [assessment] = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, req.params.id), eq(assessments.institutionId, instId)))
      .limit(1);

    if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

    // Validate assessment has valid questions before allowing launch
    const qRows = await db.select().from(questions).where(eq(questions.assessmentId, assessment.id));
    if (qRows.length === 0) {
      return res.status(400).json({
        error: 'Add at least one question before launching this session.',
      });
    }

    const optRows = await db
      .select()
      .from(questionOptions)
      .where(inArray(questionOptions.questionId, qRows.map((q) => q.id)));

    for (const q of qRows) {
      const isChoice = q.type === 'mcq' || q.type === 'multi_select';
      const qOpts = optRows.filter((o) => o.questionId === q.id);
      if (isChoice && qOpts.length < 2) {
        return res.status(400).json({
          error: `Question "${q.text.slice(0, 40)}" needs at least 2 options before launch.`,
        });
      }
      if (assessment.type === 'quiz' && isChoice && !qOpts.some((o) => o.isCorrect)) {
        return res.status(400).json({
          error: `Quiz question "${q.text.slice(0, 40)}" must have at least one correct option marked.`,
        });
      }
    }

    const isPoll = assessment.type === 'poll';
    // Polls have no time setter and stay open until the host manually ends the session
    const durationMinutes = isPoll
      ? 525600
      : parsed.data.durationMinutes ?? assessment.durationMinutes ?? 15;
    const joinCode = await generateCollisionSafeSixDigitCode(instId);
    const qrTokenRaw = generateQrToken();
    const qrTokenHash = hashQrToken(qrTokenRaw);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    const createdSession = await db.transaction(async (tx) => {
      // End any previous active session for this assessment
      await tx
        .update(sessions)
        .set({ status: 'ended', endedAt: now })
        .where(and(eq(sessions.assessmentId, assessment.id), eq(sessions.status, 'active')));

      const [sess] = await tx
        .insert(sessions)
        .values({
          assessmentId: assessment.id,
          institutionId: instId,
          hostId: req.currentUser!.id,
          joinCode,
          qrTokenHash,
          qrTokenRaw,
          qrVersion: 1,
          privacyMode: assessment.privacyMode,
          status: 'active',
          durationMinutes,
          launchedAt: now,
          expiresAt,
        })
        .returning();

      await tx
        .update(assessments)
        .set({
          status: 'active',
          activeSessionId: sess.id,
          ...(isPoll ? {} : { durationMinutes }),
          updatedAt: now,
        })
        .where(eq(assessments.id, assessment.id));

      return sess;
    });

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'session.launched',
      targetType: 'session',
      targetId: createdSession.id,
      metadata: {
        assessmentId: assessment.id,
        title: assessment.title,
        joinCode,
        privacyMode: assessment.privacyMode,
        durationMinutes,
      },
    });

    publishRealtimeEvent({
      type: 'assessment.session_launched',
      institutionId: instId,
      assessmentId: assessment.id,
      sessionId: createdSession.id,
      payload: { joinCode, expiresAt: expiresAt.toISOString(), privacyMode: assessment.privacyMode },
    });

    const dto = await serializeSessionForHost(createdSession, {
      assessmentTitle: assessment.title,
      assessmentType: assessment.type as AssessmentType,
      submissionCount: 0,
    });

    return res.status(201).json({ session: dto });
  } catch (err) {
    console.error('[host] launch error:', err);
    return res.status(500).json({ error: 'Unable to launch session.' });
  }
});

router.get('/host/sessions', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const filter = typeof req.query.status === 'string' ? req.query.status : 'all';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));

    const rows = await db
      .select({
        session: sessions,
        assessmentTitle: assessments.title,
        assessmentType: assessments.type,
      })
      .from(sessions)
      .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
      .where(eq(sessions.institutionId, instId))
      .orderBy(desc(sessions.launchedAt))
      .limit(limit);

    const ids = rows.map((r) => r.session.id);
    const subCounts = ids.length
      ? await db
          .select({ sessionId: submissions.sessionId, cnt: count() })
          .from(submissions)
          .where(inArray(submissions.sessionId, ids))
          .groupBy(submissions.sessionId)
      : [];
    const subMap = new Map(subCounts.map((c) => [c.sessionId, Number(c.cnt)]));

    const now = new Date();
    const filtered = rows.filter((r) => {
      const eff = computeEffectiveSessionStatus(r.session.status, r.session.expiresAt, now);
      if (filter === 'active') return eff === 'active';
      if (filter === 'past') return eff !== 'active';
      return true;
    });

    const list = await Promise.all(
      filtered.map((r) =>
        serializeSessionForHost(r.session, {
          assessmentTitle: r.assessmentTitle,
          assessmentType: r.assessmentType as AssessmentType,
          submissionCount: subMap.get(r.session.id) ?? 0,
        })
      )
    );

    return res.json({ sessions: list });
  } catch (err) {
    console.error('[host] list sessions error:', err);
    return res.status(500).json({ error: 'Unable to load sessions.' });
  }
});

router.post('/host/sessions/:id/qr/rotate', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const rows = await db
      .select({ session: sessions, assessmentTitle: assessments.title, assessmentType: assessments.type })
      .from(sessions)
      .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
      .where(and(eq(sessions.id, req.params.id), eq(sessions.institutionId, instId)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    const { session, assessmentTitle, assessmentType } = rows[0];

    if (computeEffectiveSessionStatus(session.status, session.expiresAt) !== 'active') {
      return res.status(409).json({ error: 'Cannot rotate QR on an expired or ended session.' });
    }

    const nextTokenRaw = generateQrToken();
    const nextTokenHash = hashQrToken(nextTokenRaw);

    const [updated] = await db
      .update(sessions)
      .set({
        qrTokenRaw: nextTokenRaw,
        qrTokenHash: nextTokenHash,
        qrVersion: session.qrVersion + 1,
      })
      .where(eq(sessions.id, session.id))
      .returning();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'session.qr_rotated',
      targetType: 'session',
      targetId: session.id,
      metadata: { qrVersion: updated.qrVersion },
    });

    publishRealtimeEvent({
      type: 'assessment.qr_rotated',
      institutionId: instId,
      assessmentId: session.assessmentId,
      sessionId: session.id,
      payload: { qrVersion: updated.qrVersion },
    });

    const dto = await serializeSessionForHost(updated, {
      assessmentTitle,
      assessmentType: assessmentType as AssessmentType,
    });
    return res.json({ session: dto });
  } catch (err) {
    console.error('[host] rotate QR error:', err);
    return res.status(500).json({ error: 'Unable to rotate QR code.' });
  }
});

router.post('/host/sessions/:id/extend', async (req: AuthRequest, res) => {
  const parsed = extendSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Specify additional minutes between 1 and 180.' });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const rows = await db
      .select({ session: sessions, assessmentTitle: assessments.title, assessmentType: assessments.type })
      .from(sessions)
      .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
      .where(and(eq(sessions.id, req.params.id), eq(sessions.institutionId, instId)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    const { session, assessmentTitle, assessmentType } = rows[0];
    if (session.status === 'ended') {
      return res.status(409).json({ error: 'Ended sessions cannot be extended. Launch a fresh session instead.' });
    }

    const baseTime = Math.max(Date.now(), session.expiresAt.getTime());
    const nextExpires = new Date(baseTime + parsed.data.additionalMinutes * 60 * 1000);

    const [updated] = await db
      .update(sessions)
      .set({
        expiresAt: nextExpires,
        status: 'active',
        durationMinutes: session.durationMinutes + parsed.data.additionalMinutes,
      })
      .where(eq(sessions.id, session.id))
      .returning();

    await db
      .update(assessments)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(assessments.id, session.assessmentId));

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'session.extended',
      targetType: 'session',
      targetId: session.id,
      metadata: { additionalMinutes: parsed.data.additionalMinutes, newExpiresAt: nextExpires.toISOString() },
    });

    publishRealtimeEvent({
      type: 'assessment.session_extended',
      institutionId: instId,
      assessmentId: session.assessmentId,
      sessionId: session.id,
      payload: { expiresAt: nextExpires.toISOString() },
    });

    const dto = await serializeSessionForHost(updated, {
      assessmentTitle,
      assessmentType: assessmentType as AssessmentType,
    });
    return res.json({ session: dto });
  } catch (err) {
    console.error('[host] extend session error:', err);
    return res.status(500).json({ error: 'Unable to extend session.' });
  }
});

router.post('/host/sessions/:id/end', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const rows = await db
      .select({ session: sessions, assessmentTitle: assessments.title, assessmentType: assessments.type })
      .from(sessions)
      .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
      .where(and(eq(sessions.id, req.params.id), eq(sessions.institutionId, instId)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    const { session, assessmentTitle, assessmentType } = rows[0];

    const now = new Date();
    const [updated] = await db
      .update(sessions)
      .set({ status: 'ended', endedAt: now })
      .where(eq(sessions.id, session.id))
      .returning();

    await db
      .update(assessments)
      .set({ status: 'expired', activeSessionId: null, updatedAt: now })
      .where(eq(assessments.id, session.assessmentId));

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'session.ended',
      targetType: 'session',
      targetId: session.id,
      metadata: { joinCode: session.joinCode },
    });

    publishRealtimeEvent({
      type: 'assessment.session_ended',
      institutionId: instId,
      assessmentId: session.assessmentId,
      sessionId: session.id,
      payload: { endedAt: now.toISOString() },
    });

    const dto = await serializeSessionForHost(updated, {
      assessmentTitle,
      assessmentType: assessmentType as AssessmentType,
    });
    return res.json({ session: dto });
  } catch (err) {
    console.error('[host] end session error:', err);
    return res.status(500).json({ error: 'Unable to end session.' });
  }
});

// ============================================================================
// 4. HOST REVIEW, MANUAL GRADING & ANSWER-KEY RECALCULATION
// ============================================================================
router.get('/host/assessments/:id/submissions', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const [assessment] = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, req.params.id), eq(assessments.institutionId, instId)))
      .limit(1);

    if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const subRows = await db
      .select({
        sub: submissions,
        joinCode: sessions.joinCode,
        studentName: profiles.displayName,
        studentEmail: profiles.email,
      })
      .from(submissions)
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      // Left join profiles ONLY on submissions.studentId (which is strictly NULL in Anonymous mode!)
      .leftJoin(profiles, eq(submissions.studentId, profiles.id))
      .where(eq(submissions.assessmentId, assessment.id))
      .orderBy(desc(submissions.submittedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(submissions)
      .where(eq(submissions.assessmentId, assessment.id));

    const items: SubmissionSummaryDTO[] = subRows.map((r) => {
      const isAnon = r.sub.privacyMode === 'anonymous';
      return {
        id: r.sub.id,
        assessmentId: r.sub.assessmentId,
        assessmentTitle: assessment.title,
        assessmentType: assessment.type as AssessmentType,
        sessionId: r.sub.sessionId,
        joinCode: r.joinCode,
        privacyMode: r.sub.privacyMode as PrivacyMode,
        participantLabel: isAnon
          ? r.sub.alias
            ? `${r.sub.anonId} (${r.sub.alias})`
            : r.sub.anonId || 'Anonymous'
          : r.studentName || 'Student',
        // STRICT PRIVACY INVARIANT: Never return email or studentId in Anonymous mode
        participantEmail: isAnon ? null : r.studentEmail ?? null,
        studentId: isAnon ? null : r.sub.studentId,
        anonId: isAnon ? r.sub.anonId : null,
        alias: isAnon ? r.sub.alias : null,
        status: r.sub.status as SubmissionStatus,
        totalScore: r.sub.totalScore,
        maxScore: r.sub.maxScore,
        percentage:
          assessment.type === 'quiz' && r.sub.maxScore > 0
            ? Math.round((r.sub.totalScore / r.sub.maxScore) * 1000) / 10
            : null,
        autoSubmitted: r.sub.autoSubmitted,
        submittedAt: r.sub.submittedAt.toISOString(),
      };
    });

    return res.json({ submissions: items, total: Number(total), limit, offset });
  } catch (err) {
    console.error('[host] list submissions error:', err);
    return res.status(500).json({ error: 'Unable to load submissions.' });
  }
});

router.get('/host/submissions/:id', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const rows = await db
      .select({
        sub: submissions,
        assessment: assessments,
        session: sessions,
        studentName: profiles.displayName,
        studentEmail: profiles.email,
      })
      .from(submissions)
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      .leftJoin(profiles, eq(submissions.studentId, profiles.id))
      .where(and(eq(submissions.id, req.params.id), eq(submissions.institutionId, instId)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Submission not found.' });
    const { sub, assessment, session, studentName, studentEmail } = rows[0];
    const isAnon = sub.privacyMode === 'anonymous';

    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessment.id))
      .orderBy(questions.position);
    const qIds = qRows.map((q) => q.id);

    const optRows = qIds.length
      ? await db
          .select()
          .from(questionOptions)
          .where(inArray(questionOptions.questionId, qIds))
          .orderBy(questionOptions.position)
      : [];
    const ansRows = await db.select().from(answers).where(eq(answers.submissionId, sub.id));
    const gradeRows = await db.select().from(gradingRecords).where(eq(gradingRecords.submissionId, sub.id));

    const ansMap = new Map(ansRows.map((a) => [a.questionId, a]));
    const gradeMap = new Map(gradeRows.map((g) => [g.questionId, g]));
    const optMap = new Map<string, Array<{ id: string; label: string; isCorrect?: boolean }>>();
    for (const o of optRows) {
      const list = optMap.get(o.questionId) ?? [];
      list.push({ id: o.id, label: o.label, isCorrect: assessment.type === 'quiz' ? o.isCorrect : undefined });
      optMap.set(o.questionId, list);
    }

    const detail: SubmissionDetailDTO = {
      id: sub.id,
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      assessmentType: assessment.type as AssessmentType,
      sessionId: session.id,
      joinCode: session.joinCode,
      privacyMode: sub.privacyMode as PrivacyMode,
      participantLabel: isAnon
        ? sub.alias
          ? `${sub.anonId} (${sub.alias})`
          : sub.anonId || 'Anonymous'
        : studentName || 'Student',
      participantEmail: isAnon ? null : studentEmail ?? null,
      studentId: isAnon ? null : sub.studentId,
      anonId: isAnon ? sub.anonId : null,
      alias: isAnon ? sub.alias : null,
      status: sub.status as SubmissionStatus,
      totalScore: sub.totalScore,
      maxScore: sub.maxScore,
      percentage:
        assessment.type === 'quiz' && sub.maxScore > 0
          ? Math.round((sub.totalScore / sub.maxScore) * 1000) / 10
          : null,
      autoSubmitted: sub.autoSubmitted,
      startedAt: sub.startedAt.toISOString(),
      submittedAt: sub.submittedAt.toISOString(),
      hasPendingWritten: gradeRows.some((g) => g.outcome === 'pending'),
      items: qRows.map((q) => {
        const a = ansMap.get(q.id);
        const g = gradeMap.get(q.id);
        return {
          questionId: q.id,
          position: q.position,
          type: q.type as QuestionType,
          text: q.text,
          points: assessment.type === 'quiz' ? q.points : 0,
          rubric: assessment.type === 'quiz' ? q.rubric : null,
          options: optMap.get(q.id) ?? [],
          selectedOptionIds: a?.selectedOptionIds ?? [],
          textAnswer: a?.textAnswer ?? null,
          grading: g
            ? {
                awardedPoints: g.awardedPoints,
                maxPoints: g.maxPoints,
                outcome: g.outcome as GradingOutcome,
                feedback: g.feedback,
                manuallyGraded: g.manuallyGraded,
                updatedAt: g.updatedAt.toISOString(),
              }
            : null,
        };
      }),
    };

    return res.json({ submission: detail });
  } catch (err) {
    console.error('[host] get submission error:', err);
    return res.status(500).json({ error: 'Unable to load submission details.' });
  }
});

// Save manual grading atomically & recompute total score + status server-side
router.patch('/host/submissions/:id/grades', async (req: AuthRequest, res) => {
  const parsed = gradeSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid grading payload.',
    });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const rows = await db
      .select({ sub: submissions, assessment: assessments })
      .from(submissions)
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .where(and(eq(submissions.id, req.params.id), eq(submissions.institutionId, instId)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Submission not found.' });
    const { sub, assessment } = rows[0];

    if (assessment.type !== 'quiz') {
      return res.status(400).json({ error: 'Poll responses cannot be graded.' });
    }

    const qRows = await db.select().from(questions).where(eq(questions.assessmentId, assessment.id));
    const qMap = new Map(qRows.map((q) => [q.id, q]));

    for (const g of parsed.data.grades) {
      const q = qMap.get(g.questionId);
      if (!q) return res.status(400).json({ error: 'Grade contains an unknown question ID.' });
      if (g.awardedPoints < 0 || g.awardedPoints > q.points) {
        return res.status(400).json({
          error: `Awarded marks (${g.awardedPoints}) must be between 0 and ${q.points} for question "${q.text.slice(0, 35)}".`,
        });
      }
    }

    const totals = await db.transaction(async (tx) => {
      for (const g of parsed.data.grades) {
        const q = qMap.get(g.questionId)!;
        const outcome: GradingOutcome =
          g.awardedPoints >= q.points && q.points > 0
            ? 'correct'
            : g.awardedPoints > 0
            ? 'partial'
            : 'incorrect';

        await tx
          .insert(gradingRecords)
          .values({
            submissionId: sub.id,
            questionId: q.id,
            awardedPoints: g.awardedPoints,
            maxPoints: q.points,
            outcome,
            feedback: g.feedback ?? null,
            graderId: req.currentUser!.id,
            manuallyGraded: true,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [gradingRecords.submissionId, gradingRecords.questionId],
            set: {
              awardedPoints: g.awardedPoints,
              maxPoints: q.points,
              outcome,
              feedback: g.feedback ?? null,
              graderId: req.currentUser!.id,
              manuallyGraded: true,
              updatedAt: new Date(),
            },
          });
      }

      const allGrades = await tx
        .select()
        .from(gradingRecords)
        .where(eq(gradingRecords.submissionId, sub.id));

      const computed = computeSubmissionTotals(allGrades);
      await tx
        .update(submissions)
        .set({
          totalScore: computed.totalScore,
          maxScore: computed.maxScore,
          status: computed.status,
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, sub.id));

      return computed;
    });

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'submission.graded',
      targetType: 'submission',
      targetId: sub.id,
      changedFields: ['grading_records', 'totalScore', 'status'],
      metadata: {
        assessmentId: assessment.id,
        totalScore: totals.totalScore,
        maxScore: totals.maxScore,
        status: totals.status,
      },
    });

    // Resolve recipient studentId for server-internal realtime delivery (NEVER returned to host!)
    let notifyStudentId: string | undefined = sub.studentId ?? undefined;
    if (!notifyStudentId && sub.privacyMode === 'anonymous') {
      const [claim] = await db
        .select({ studentId: studentPrivateSessionClaims.studentId })
        .from(studentPrivateSessionClaims)
        .where(eq(studentPrivateSessionClaims.submissionId, sub.id))
        .limit(1);
      notifyStudentId = claim?.studentId;
    }

    publishRealtimeEvent({
      type: 'submission.graded',
      institutionId: instId,
      assessmentId: assessment.id,
      sessionId: sub.sessionId,
      submissionId: sub.id,
      studentId: notifyStudentId,
      payload: {
        submissionId: sub.id,
        totalScore: totals.totalScore,
        maxScore: totals.maxScore,
        status: totals.status,
      },
    });

    return res.json({
      submissionId: sub.id,
      totalScore: totals.totalScore,
      maxScore: totals.maxScore,
      status: totals.status,
    });
  } catch (err) {
    console.error('[host] grade submission error:', err);
    return res.status(500).json({ error: 'Unable to save grades.' });
  }
});

// Recalculate objective grades across all submissions atomically after answer-key edit
router.post('/host/assessments/:id/recalculate', async (req: AuthRequest, res) => {
  const parsed = recalculateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid recalculation request.' });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const [assessment] = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, req.params.id), eq(assessments.institutionId, instId)))
      .limit(1);

    if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });
    if (assessment.type !== 'quiz') {
      return res.status(400).json({ error: 'Recalculation applies only to Quiz assessments.' });
    }

    const qRows = await db.select().from(questions).where(eq(questions.assessmentId, assessment.id));
    const qIds = qRows.map((q) => q.id);
    const optRows = qIds.length
      ? await db.select().from(questionOptions).where(inArray(questionOptions.questionId, qIds))
      : [];

    const correctByQ = new Map<string, string[]>();
    for (const o of optRows) {
      if (o.isCorrect) {
        const list = correctByQ.get(o.questionId) ?? [];
        list.push(o.id);
        correctByQ.set(o.questionId, list);
      }
    }

    const subRows = await db.select().from(submissions).where(eq(submissions.assessmentId, assessment.id));
    if (subRows.length === 0) {
      return res.json({ recalculatedCount: 0, submissionIds: [] });
    }

    const subIds = subRows.map((s) => s.id);
    const allAns = await db.select().from(answers).where(inArray(answers.submissionId, subIds));
    const allExistingGrades = await db
      .select()
      .from(gradingRecords)
      .where(inArray(gradingRecords.submissionId, subIds));

    const ansKeyMap = new Map(allAns.map((a) => [`${a.submissionId}:${a.questionId}`, a]));
    const gradeKeyMap = new Map(allExistingGrades.map((g) => [`${g.submissionId}:${g.questionId}`, g]));

    const recalculatedIds: string[] = [];

    await db.transaction(async (tx) => {
      for (const sub of subRows) {
        const updatedRecords: Array<{ awardedPoints: number; maxPoints: number; outcome: string }> = [];

        for (const q of qRows) {
          const key = `${sub.id}:${q.id}`;
          const existingG = gradeKeyMap.get(key);
          const ans = ansKeyMap.get(key);

          const isWritten = q.type === 'short_answer' || q.type === 'paragraph';
          if (isWritten && existingG?.manuallyGraded && !parsed.data.resetManualGrades) {
            // Preserve manually awarded written marks, clamping only if maxPoints shrank
            const clampedAwarded = Math.min(existingG.awardedPoints, q.points);
            await tx
              .update(gradingRecords)
              .set({ awardedPoints: clampedAwarded, maxPoints: q.points, updatedAt: new Date() })
              .where(eq(gradingRecords.id, existingG.id));
            updatedRecords.push({
              awardedPoints: clampedAwarded,
              maxPoints: q.points,
              outcome: existingG.outcome,
            });
            continue;
          }

          const resGrade = gradeObjectiveQuestion(
            {
              id: q.id,
              type: q.type as QuestionType,
              points: q.points,
              partialCredit: Boolean(q.settings?.partialCredit),
              correctOptionIds: correctByQ.get(q.id) ?? [],
            },
            ans?.selectedOptionIds ?? []
          );

          await tx
            .insert(gradingRecords)
            .values({
              submissionId: sub.id,
              questionId: q.id,
              awardedPoints: resGrade.awardedPoints,
              maxPoints: resGrade.maxPoints,
              outcome: resGrade.outcome,
              manuallyGraded: false,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [gradingRecords.submissionId, gradingRecords.questionId],
              set: {
                awardedPoints: resGrade.awardedPoints,
                maxPoints: resGrade.maxPoints,
                outcome: resGrade.outcome,
                manuallyGraded: false,
                updatedAt: new Date(),
              },
            });

          updatedRecords.push({
            awardedPoints: resGrade.awardedPoints,
            maxPoints: resGrade.maxPoints,
            outcome: resGrade.outcome,
          });
        }

        const totals = computeSubmissionTotals(updatedRecords);
        await tx
          .update(submissions)
          .set({
            totalScore: totals.totalScore,
            maxScore: totals.maxScore,
            status: totals.status,
            updatedAt: new Date(),
          })
          .where(eq(submissions.id, sub.id));

        recalculatedIds.push(sub.id);
      }
    });

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'quiz.grades_recalculated',
      targetType: 'assessment',
      targetId: assessment.id,
      changedFields: ['grading_records', 'totalScore'],
      metadata: {
        recalculatedCount: recalculatedIds.length,
        resetManualGrades: parsed.data.resetManualGrades,
        reason: parsed.data.reason ?? 'Answer key updated',
      },
    });

    publishRealtimeEvent({
      type: 'submission.recalculated',
      institutionId: instId,
      assessmentId: assessment.id,
      payload: { recalculatedCount: recalculatedIds.length },
    });

    return res.json({
      recalculatedCount: recalculatedIds.length,
      submissionIds: recalculatedIds,
    });
  } catch (err) {
    console.error('[host] recalculate error:', err);
    return res.status(500).json({ error: 'Unable to recalculate quiz grades.' });
  }
});

// ============================================================================
// 5. QUIZ ANALYTICS & POLL ANALYTICS + CSV EXPORT
// ============================================================================
router.get('/host/assessments/:id/quiz-analytics', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const [assessment] = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, req.params.id), eq(assessments.institutionId, instId)))
      .limit(1);

    if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });
    if (assessment.type !== 'quiz') {
      return res.status(400).json({ error: 'Quiz analytics is only available for Quiz assessments.' });
    }

    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessment.id))
      .orderBy(questions.position);
    const subRows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.assessmentId, assessment.id));
    const subIds = subRows.map((s) => s.id);
    const gradeRows = subIds.length
      ? await db.select().from(gradingRecords).where(inArray(gradingRecords.submissionId, subIds))
      : [];

    const attemptCount = subRows.length;
    const pendingReviewCount = subRows.filter((s) => s.status === 'pending_review').length;
    const reviewedCount = subRows.filter((s) => s.status === 'reviewed').length;
    const maxPossibleScore = qRows.reduce((acc, q) => acc + q.points, 0);

    const scores = subRows.map((s) => s.totalScore);
    const averageScore =
      scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    // Score distribution buckets (0-20%, 21-40%, 41-60%, 61-80%, 81-100%)
    const buckets = [
      { bucket: '0–20%', min: 0, max: 20, count: 0 },
      { bucket: '21–40%', min: 20.001, max: 40, count: 0 },
      { bucket: '41–60%', min: 40.001, max: 60, count: 0 },
      { bucket: '61–80%', min: 60.001, max: 80, count: 0 },
      { bucket: '81–100%', min: 80.001, max: 100.1, count: 0 },
    ];
    for (const s of subRows) {
      const pct = s.maxScore > 0 ? (s.totalScore / s.maxScore) * 100 : 0;
      const found = buckets.find((b) => pct >= b.min && pct <= b.max) ?? buckets[0];
      found.count += 1;
    }

    const questionStats = qRows.map((q) => {
      const qGrades = gradeRows.filter((g) => g.questionId === q.id);
      const pendingCount = qGrades.filter((g) => g.outcome === 'pending').length;
      const graded = qGrades.filter((g) => g.outcome !== 'pending');
      const avgAwarded =
        graded.length > 0
          ? Math.round((graded.reduce((a, g) => a + g.awardedPoints, 0) / graded.length) * 100) / 100
          : 0;
      const accuracyRate =
        graded.length > 0 && q.points > 0
          ? Math.round((avgAwarded / q.points) * 1000) / 10
          : 0;

      return {
        questionId: q.id,
        position: q.position,
        text: q.text,
        type: q.type as QuestionType,
        maxPoints: q.points,
        averageAwarded: avgAwarded,
        accuracyRate,
        pendingCount,
      };
    });

    const dto: QuizAnalyticsDTO = {
      assessmentId: assessment.id,
      title: assessment.title,
      privacyMode: assessment.privacyMode as PrivacyMode,
      attemptCount,
      completionCount: attemptCount,
      pendingReviewCount,
      reviewedCount,
      isProvisional: pendingReviewCount > 0,
      maxPossibleScore,
      averageScore,
      highestScore,
      lowestScore,
      distribution: buckets.map((b) => ({ bucket: b.bucket, count: b.count })),
      questionStats,
    };

    return res.json({ analytics: dto });
  } catch (err) {
    console.error('[host] quiz analytics error:', err);
    return res.status(500).json({ error: 'Unable to compute quiz analytics.' });
  }
});

async function computePollAnalyticsForHost(assessmentId: string, institutionId: string) {
  const [assessment] = await db
    .select()
    .from(assessments)
    .where(and(eq(assessments.id, assessmentId), eq(assessments.institutionId, institutionId)))
    .limit(1);

  if (!assessment || assessment.type !== 'poll') return null;

  const qRows = await db
    .select()
    .from(questions)
    .where(eq(questions.assessmentId, assessment.id))
    .orderBy(questions.position);
  const qIds = qRows.map((q) => q.id);

  const optRows = qIds.length
    ? await db
        .select()
        .from(questionOptions)
        .where(inArray(questionOptions.questionId, qIds))
        .orderBy(questionOptions.position)
    : [];

  const subRows = await db
    .select({
      sub: submissions,
      studentName: profiles.displayName,
      studentEmail: profiles.email,
    })
    .from(submissions)
    .leftJoin(profiles, eq(submissions.studentId, profiles.id))
    .where(eq(submissions.assessmentId, assessment.id))
    .orderBy(desc(submissions.submittedAt));

  const subIds = subRows.map((r) => r.sub.id);
  const ansRows = subIds.length
    ? await db.select().from(answers).where(inArray(answers.submissionId, subIds))
    : [];

  const ansBySub = new Map<string, Array<{ questionId: string; selectedOptionIds: string[]; textAnswer: string | null }>>();
  for (const a of ansRows) {
    const list = ansBySub.get(a.submissionId) ?? [];
    list.push({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds ?? [],
      textAnswer: a.textAnswer,
    });
    ansBySub.set(a.submissionId, list);
  }

  return aggregatePollResults({
    assessmentId: assessment.id,
    title: assessment.title,
    privacyMode: assessment.privacyMode as PrivacyMode,
    questions: qRows.map((q) => ({
      id: q.id,
      position: q.position,
      type: q.type as QuestionType,
      text: q.text,
      options: optRows
        .filter((o) => o.questionId === q.id)
        .map((o) => ({ id: o.id, position: o.position, label: o.label })),
    })),
    submissions: subRows.map((r) => {
      const isAnon = r.sub.privacyMode === 'anonymous';
      return {
        id: r.sub.id,
        // STRICT PRIVACY INVARIANT: Anonymous polls NEVER expose student name or email!
        participantLabel: isAnon
          ? r.sub.alias
            ? `${r.sub.anonId} (${r.sub.alias})`
            : r.sub.anonId || 'Anonymous'
          : r.studentEmail
          ? `${r.studentName || 'Student'} (${r.studentEmail})`
          : r.studentName || 'Student',
        submittedAt: r.sub.submittedAt.toISOString(),
        answers: ansBySub.get(r.sub.id) ?? [],
      };
    }),
  });
}

router.get('/host/assessments/:id/poll-results', async (req: AuthRequest, res) => {
  try {
    const analytics = await computePollAnalyticsForHost(req.params.id, req.currentUser!.institutionId);
    if (!analytics) return res.status(404).json({ error: 'Poll assessment not found.' });
    return res.json({ analytics });
  } catch (err) {
    console.error('[host] poll-results error:', err);
    return res.status(500).json({ error: 'Unable to compute poll results.' });
  }
});

router.get('/host/assessments/:id/poll-export', async (req: AuthRequest, res) => {
  try {
    const analytics = await computePollAnalyticsForHost(req.params.id, req.currentUser!.institutionId);
    if (!analytics) return res.status(404).json({ error: 'Poll assessment not found.' });

    const csv = buildPollCsvExport(analytics);
    const safeFilename = analytics.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'poll_report';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_${analytics.privacyMode}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('[host] poll-export error:', err);
    return res.status(500).json({ error: 'Unable to export poll CSV.' });
  }
});

// ============================================================================
// 6. STUDENT DATABASE & STUDENT DATA RETRIEVAL (Email Search + Allowlisted Edits)
// ============================================================================
router.get('/host/students', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const conditions = [eq(profiles.institutionId, instId), eq(profiles.role, 'student')];
    if (search) {
      conditions.push(
        or(
          ilike(profiles.displayName, `%${search}%`),
          ilike(profiles.email, `%${search}%`),
          ilike(profiles.classSection, `%${search}%`),
          ilike(profiles.studentCode, `%${search}%`)
        )!
      );
    }

    const rows = await db
      .select()
      .from(profiles)
      .where(and(...conditions))
      .orderBy(desc(profiles.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(profiles)
      .where(and(...conditions));

    const students: UserProfile[] = rows.map((p) => ({
      id: p.id,
      email: p.email,
      displayName: p.displayName,
      role: p.role as UserRole,
      serverAdmin: p.serverAdmin,
      institutionId: p.institutionId,
      studentCode: p.studentCode,
      classSection: p.classSection,
      department: p.department,
      notes: p.notes,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return res.json({ students, total: Number(total), limit, offset });
  } catch (err) {
    console.error('[host] list students error:', err);
    return res.status(500).json({ error: 'Unable to load student directory.' });
  }
});

// Provision a new student account in the host's institution
router.post('/host/students', async (req: AuthRequest, res) => {
  const parsed = createStudentByHostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid student details.',
    });
  }

  try {
    const email = parsed.data.email.trim().toLowerCase();
    const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, email)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const [created] = await db
      .insert(profiles)
      .values({
        authUid: `local:${crypto.randomUUID()}`,
        email,
        passwordHash: hashPassword(parsed.data.password),
        displayName: parsed.data.displayName.trim(),
        institutionId: req.currentUser!.institutionId,
        role: 'student',
        serverAdmin: false,
        studentCode: parsed.data.studentCode?.trim() || `STU-${crypto.randomInt(10000, 99999)}`,
        classSection: parsed.data.classSection?.trim() || null,
        department: parsed.data.department?.trim() || null,
        status: 'active',
      })
      .returning();

    await db
      .insert(institutionMemberships)
      .values({
        userId: created.id,
        institutionId: req.currentUser!.institutionId,
        membershipRole: 'student',
        status: 'active',
      })
      .onConflictDoNothing();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: 'student.provisioned',
      targetType: 'student',
      targetId: created.id,
      changedFields: ['displayName', 'email', 'classSection', 'department'],
      metadata: { studentEmail: created.email },
    });

    return res.status(201).json({
      student: {
        id: created.id,
        email: created.email,
        displayName: created.displayName,
        role: created.role,
        serverAdmin: created.serverAdmin,
        institutionId: created.institutionId,
        studentCode: created.studentCode,
        classSection: created.classSection,
        department: created.department,
        notes: created.notes,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[host] provision student error:', err);
    return res.status(500).json({ error: 'Unable to add student.' });
  }
});

// Dedicated Student Data Retrieval by Email (STRICTLY institution-scoped & Normal-mode ONLY!)
router.get('/host/students/search', emailSearchRateLimit, async (req: AuthRequest, res) => {
  const rawEmail = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ error: 'Enter a valid student email address to search.' });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const rows = await db
      .select({ profile: profiles, institutionName: institutions.name })
      .from(profiles)
      .innerJoin(institutions, eq(profiles.institutionId, institutions.id))
      .where(
        and(
          eq(profiles.email, rawEmail),
          eq(profiles.institutionId, instId),
          eq(profiles.role, 'student')
        )
      )
      .limit(1);

    // Do NOT reveal whether this email exists in another institution
    if (!rows[0]) {
      return res.status(404).json({
        error: 'No student record matching that email was found within your authorized institution scope.',
        code: 'STUDENT_NOT_FOUND',
      });
    }

    const { profile, institutionName } = rows[0];

    // CRITICAL PRIVACY BOUNDARY: Query ONLY Normal-mode submissions where submissions.studentId = profile.id!
    // NEVER join student_private_session_claims or expose Anonymous-mode responses!
    const normalSubs = await db
      .select({
        sub: submissions,
        assessmentTitle: assessments.title,
        assessmentType: assessments.type,
        joinCode: sessions.joinCode,
      })
      .from(submissions)
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      .where(
        and(
          eq(submissions.studentId, profile.id),
          eq(submissions.institutionId, instId),
          eq(submissions.privacyMode, 'normal')
        )
      )
      .orderBy(desc(submissions.submittedAt))
      .limit(50);

    const subIds = normalSubs.map((s) => s.sub.id);
    const assessmentIds = Array.from(new Set(normalSubs.map((s) => s.sub.assessmentId)));

    const [ansRows, gradeRows, qRows, optRows, studentAudits] = await Promise.all([
      subIds.length ? db.select().from(answers).where(inArray(answers.submissionId, subIds)) : [],
      subIds.length ? db.select().from(gradingRecords).where(inArray(gradingRecords.submissionId, subIds)) : [],
      assessmentIds.length
        ? db.select().from(questions).where(inArray(questions.assessmentId, assessmentIds)).orderBy(questions.position)
        : [],
      assessmentIds.length
        ? db
            .select({ id: questionOptions.id, label: questionOptions.label })
            .from(questionOptions)
            .innerJoin(questions, eq(questionOptions.questionId, questions.id))
            .where(inArray(questions.assessmentId, assessmentIds))
        : [],
      db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.institutionId, instId),
            eq(auditLogs.targetType, 'student'),
            eq(auditLogs.targetId, profile.id)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(20),
    ]);

    const optLabelMap = new Map(optRows.map((o) => [o.id, o.label]));
    const quizSubs = normalSubs.filter((s) => s.assessmentType === 'quiz');
    const pollSubs = normalSubs.filter((s) => s.assessmentType === 'poll');
    const scoredQuizzes = quizSubs.filter((s) => s.sub.maxScore > 0);
    const averageQuizPercentage =
      scoredQuizzes.length > 0
        ? Math.round(
            (scoredQuizzes.reduce((acc, s) => acc + (s.sub.totalScore / s.sub.maxScore) * 100, 0) /
              scoredQuizzes.length) *
              10
          ) / 10
        : null;

    const activity = normalSubs.map((r) => {
      const subQuestions = qRows.filter((q) => q.assessmentId === r.sub.assessmentId);
      return {
        submissionId: r.sub.id,
        assessmentId: r.sub.assessmentId,
        assessmentTitle: r.assessmentTitle,
        assessmentType: r.assessmentType as AssessmentType,
        sessionId: r.sub.sessionId,
        joinCode: r.joinCode,
        status: r.sub.status as SubmissionStatus,
        totalScore: r.sub.totalScore,
        maxScore: r.sub.maxScore,
        submittedAt: r.sub.submittedAt.toISOString(),
        answers: subQuestions.map((q) => {
          const a = ansRows.find((x) => x.submissionId === r.sub.id && x.questionId === q.id);
          const g = gradeRows.find((x) => x.submissionId === r.sub.id && x.questionId === q.id);
          const answerDisplay =
            q.type === 'mcq' || q.type === 'multi_select'
              ? (a?.selectedOptionIds ?? []).map((id) => optLabelMap.get(id) || 'Option').join(', ') || '(No selection)'
              : a?.textAnswer || '(No response)';

          return {
            questionText: q.text,
            questionType: q.type as QuestionType,
            answerDisplay,
            awardedPoints: r.assessmentType === 'quiz' ? g?.awardedPoints ?? 0 : null,
            maxPoints: r.assessmentType === 'quiz' ? q.points : null,
            outcome: r.assessmentType === 'quiz' ? g?.outcome ?? 'pending' : null,
            feedback: r.assessmentType === 'quiz' ? g?.feedback ?? null : null,
          };
        }),
      };
    });

    const result: StudentRetrievalResultDTO = {
      student: {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role as UserRole,
        serverAdmin: profile.serverAdmin,
        institutionId: profile.institutionId,
        institutionName,
        studentCode: profile.studentCode,
        classSection: profile.classSection,
        department: profile.department,
        notes: profile.notes,
        status: profile.status,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      normalModeSummary: {
        totalQuizAttempts: quizSubs.length,
        totalPollParticipations: pollSubs.length,
        averageQuizPercentage,
        pendingReviews: quizSubs.filter((s) => s.sub.status === 'pending_review').length,
      },
      activity,
      auditHistory: studentAudits.map(serializeAudit),
    };

    return res.json(result);
  } catch (err) {
    console.error('[host] student search error:', err);
    return res.status(500).json({ error: 'Unable to retrieve student record.' });
  }
});

// Edit strict allowlist of student profile fields with optimistic concurrency & immutable audit log
router.patch('/host/students/:id', async (req: AuthRequest, res) => {
  // Reject attempts to mutate protected fields explicitly
  const forbiddenKeys = ['email', 'role', 'password', 'passwordHash', 'institutionId', 'authUid', 'serverAdmin', 'studentCode'];
  for (const key of forbiddenKeys) {
    if (key in (req.body || {})) {
      return res.status(403).json({
        error: `Field "${key}" is protected and cannot be modified through Host Data Retrieval.`,
        code: 'PROTECTED_FIELD',
      });
    }
  }

  const parsed = updateStudentProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid profile update.',
    });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const [existing] = await db
      .select()
      .from(profiles)
      .where(
        and(
          eq(profiles.id, req.params.id),
          eq(profiles.institutionId, instId),
          eq(profiles.role, 'student')
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Student not found in your authorized scope.' });
    }

    // Optimistic concurrency check
    if (
      parsed.data.expectedUpdatedAt &&
      Math.abs(new Date(parsed.data.expectedUpdatedAt).getTime() - existing.updatedAt.getTime()) > 1000
    ) {
      return res.status(409).json({
        error: 'This student record was modified by another user. Reload the latest data before saving.',
        code: 'CONCURRENT_EDIT_CONFLICT',
      });
    }

    const changedFields: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const updatePatch: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() };

    const allowlist: Array<'displayName' | 'classSection' | 'department' | 'notes' | 'status'> = [
      'displayName',
      'classSection',
      'department',
      'notes',
      'status',
    ];

    for (const field of allowlist) {
      if (parsed.data[field] !== undefined && parsed.data[field] !== existing[field]) {
        changedFields.push(field);
        before[field] = existing[field];
        after[field] = parsed.data[field];
        (updatePatch as Record<string, unknown>)[field] = parsed.data[field];
      }
    }

    if (changedFields.length === 0) {
      return res.json({
        student: {
          id: existing.id,
          email: existing.email,
          displayName: existing.displayName,
          role: existing.role,
          serverAdmin: existing.serverAdmin,
          institutionId: existing.institutionId,
          studentCode: existing.studentCode,
          classSection: existing.classSection,
          department: existing.department,
          notes: existing.notes,
          status: existing.status,
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
        },
        changedFields: [],
      });
    }

    const [updated] = await db
      .update(profiles)
      .set(updatePatch)
      .where(eq(profiles.id, existing.id))
      .returning();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'student.profile_updated',
      targetType: 'student',
      targetId: updated.id,
      changedFields,
      metadata: { before, after, studentEmail: updated.email },
    });

    publishRealtimeEvent({
      type: 'student.profile_updated',
      institutionId: instId,
      studentId: updated.id,
      payload: { studentId: updated.id, changedFields },
    });

    return res.json({
      student: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
        serverAdmin: updated.serverAdmin,
        institutionId: updated.institutionId,
        studentCode: updated.studentCode,
        classSection: updated.classSection,
        department: updated.department,
        notes: updated.notes,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      changedFields,
    });
  } catch (err) {
    console.error('[host] update student error:', err);
    return res.status(500).json({ error: 'Unable to persist student profile changes.' });
  }
});

// ============================================================================
// 7. AUDIT LOGS & SETTINGS
// ============================================================================
router.get('/host/audit-logs', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const conditions = [eq(auditLogs.institutionId, instId)];
    if (search) {
      conditions.push(
        or(
          ilike(auditLogs.action, `%${search}%`),
          ilike(auditLogs.actorEmail, `%${search}%`),
          ilike(auditLogs.targetType, `%${search}%`)
        )!
      );
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(auditLogs)
      .where(and(...conditions));

    return res.json({ logs: rows.map(serializeAudit), total: Number(total), limit, offset });
  } catch (err) {
    console.error('[host] audit logs error:', err);
    return res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

router.get('/host/settings', async (req: AuthRequest, res) => {
  try {
    const [inst] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.id, req.currentUser!.institutionId))
      .limit(1);
    const [prof] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, req.currentUser!.id))
      .limit(1);

    return res.json({
      profile: {
        displayName: prof?.displayName ?? req.currentUser!.displayName,
        email: prof?.email ?? req.currentUser!.email,
        department: prof?.department ?? null,
        role: prof?.role ?? req.currentUser!.role,
        serverAdmin: Boolean(prof?.serverAdmin),
      },
      institution: {
        id: inst.id,
        name: inst.name,
        code: inst.code,
        settings: inst.settings ?? {},
      },
    });
  } catch (err) {
    console.error('[host] settings error:', err);
    return res.status(500).json({ error: 'Unable to load settings.' });
  }
});

router.patch('/host/settings', async (req: AuthRequest, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings.' });
  }

  try {
    const instId = req.currentUser!.institutionId;
    if (parsed.data.displayName !== undefined || parsed.data.department !== undefined) {
      await db
        .update(profiles)
        .set({
          ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
          ...(parsed.data.department !== undefined ? { department: parsed.data.department } : {}),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, req.currentUser!.id));
    }

    if (
      req.currentUser!.role === 'platform_admin' &&
      (parsed.data.institutionName !== undefined ||
        parsed.data.allowStudentSelfRegistration !== undefined ||
        parsed.data.defaultPrivacyMode !== undefined)
    ) {
      const [inst] = await db.select().from(institutions).where(eq(institutions.id, instId)).limit(1);
      const nextSettings = {
        ...(inst?.settings ?? {}),
        ...(parsed.data.allowStudentSelfRegistration !== undefined
          ? { allowStudentSelfRegistration: parsed.data.allowStudentSelfRegistration }
          : {}),
        ...(parsed.data.defaultPrivacyMode !== undefined
          ? { defaultPrivacyMode: parsed.data.defaultPrivacyMode }
          : {}),
      };
      await db
        .update(institutions)
        .set({
          ...(parsed.data.institutionName ? { name: parsed.data.institutionName } : {}),
          settings: nextSettings,
          updatedAt: new Date(),
        })
        .where(eq(institutions.id, instId));

      await recordAuditLog({
        actorId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        institutionId: instId,
        action: 'institution.settings_updated',
        targetType: 'institution',
        targetId: instId,
        changedFields: Object.keys(parsed.data),
        metadata: { settings: nextSettings },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[host] update settings error:', err);
    return res.status(500).json({ error: 'Unable to save settings.' });
  }
});

// ============================================================================
// 8. HOST ACCESS MANAGEMENT (Add / List / Revoke Host Emails)
// ============================================================================
router.get('/host/hosts', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const currentEmail = req.currentUser!.email.trim().toLowerCase();

    const [inst] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.id, instId))
      .limit(1);

    const addedHosts: AddedHostEntry[] = Array.isArray(inst?.settings?.addedHosts)
      ? inst.settings.addedHosts
      : [];

    const allHostEmails = Array.from(
      new Set<string>([
        ...Array.from(PRIMARY_HOST_EMAILS),
        ...addedHosts.map((h) => h.email.trim().toLowerCase()),
      ])
    );

    const matchedProfiles =
      allHostEmails.length > 0
        ? await db
            .select({
              email: profiles.email,
              displayName: profiles.displayName,
              status: profiles.status,
              createdAt: profiles.createdAt,
            })
            .from(profiles)
            .where(and(eq(profiles.institutionId, instId), inArray(profiles.email, allHostEmails)))
        : [];

    const profileByEmail = new Map(
      matchedProfiles.map((p) => [p.email.trim().toLowerCase(), p])
    );

    const primaryRecords: HostAccessRecordDTO[] = Array.from(PRIMARY_HOST_EMAILS).map((email) => {
      const p = profileByEmail.get(email);
      return {
        email,
        displayName: p?.displayName || email.split('@')[0],
        role: 'platform_admin',
        isPrimary: true,
        hasSignedIn: Boolean(p),
        status: p?.status || 'active',
        addedByEmail: null,
        addedAt: p?.createdAt ? p.createdAt.toISOString() : null,
        isCurrentUser: email === currentEmail,
      };
    });

    const addedRecords: HostAccessRecordDTO[] = addedHosts
      .filter((entry) => !isPrimaryHostEmail(entry.email))
      .map((entry) => {
        const normalized = entry.email.trim().toLowerCase();
        const p = profileByEmail.get(normalized);
        return {
          email: normalized,
          displayName: p?.displayName || entry.displayName?.trim() || normalized.split('@')[0],
          role: 'host' as const,
          isPrimary: false,
          hasSignedIn: Boolean(p),
          status: p?.status || 'invited',
          addedByEmail: entry.addedByEmail || null,
          addedAt: entry.addedAt || null,
          isCurrentUser: normalized === currentEmail,
        };
      })
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

    return res.json({ hosts: [...primaryRecords, ...addedRecords] });
  } catch (err) {
    console.error('[host] list hosts error:', err);
    return res.status(500).json({ error: 'Unable to load authorized hosts.' });
  }
});

router.post('/host/hosts', hostManageRateLimit, async (req: AuthRequest, res) => {
  const parsed = addHostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Please enter a valid email address.',
    });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const optionalName = parsed.data.displayName?.trim() || null;

    if (isPrimaryHostEmail(normalizedEmail)) {
      return res.status(409).json({
        error: 'This email address is already a Primary Host.',
      });
    }

    const [inst] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.id, instId))
      .limit(1);

    if (!inst) {
      return res.status(404).json({ error: 'Institution not found.' });
    }

    const existingAdded: AddedHostEntry[] = Array.isArray(inst.settings?.addedHosts)
      ? inst.settings.addedHosts
      : [];

    if (existingAdded.some((h) => h.email.trim().toLowerCase() === normalizedEmail)) {
      return res.status(409).json({
        error: 'This email address already has Host access.',
      });
    }

    const newEntry: AddedHostEntry = {
      email: normalizedEmail,
      displayName: optionalName,
      addedByEmail: req.currentUser!.email,
      addedAt: new Date().toISOString(),
    };

    const nextSettings = {
      ...(inst.settings ?? {}),
      addedHosts: [...existingAdded, newEntry],
    };

    await db
      .update(institutions)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(institutions.id, instId));

    // If the user already has a profile in this institution (e.g. signed in earlier as student), upgrade role immediately
    const [existingProfile] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.email, normalizedEmail), eq(profiles.institutionId, instId)))
      .limit(1);

    if (existingProfile) {
      await db
        .update(profiles)
        .set({
          role: 'host',
          serverAdmin: false,
          ...(optionalName && !existingProfile.displayName ? { displayName: optionalName } : {}),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, existingProfile.id));

      await db
        .update(institutionMemberships)
        .set({ membershipRole: 'host' })
        .where(
          and(
            eq(institutionMemberships.userId, existingProfile.id),
            eq(institutionMemberships.institutionId, instId)
          )
        );
    }

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'host.added',
      targetType: 'host',
      targetId: existingProfile?.id ?? null,
      changedFields: ['role'],
      metadata: {
        email: normalizedEmail,
        displayName: existingProfile?.displayName || optionalName,
        upgradedExistingProfile: Boolean(existingProfile),
      },
    });

    const record: HostAccessRecordDTO = {
      email: normalizedEmail,
      displayName: existingProfile?.displayName || optionalName || normalizedEmail.split('@')[0],
      role: 'host',
      isPrimary: false,
      hasSignedIn: Boolean(existingProfile),
      status: existingProfile?.status || 'invited',
      addedByEmail: newEntry.addedByEmail,
      addedAt: newEntry.addedAt,
      isCurrentUser: normalizedEmail === req.currentUser!.email.trim().toLowerCase(),
    };

    return res.status(201).json({ host: record });
  } catch (err) {
    console.error('[host] add host error:', err);
    return res.status(500).json({ error: 'Unable to add host right now.' });
  }
});

router.delete('/host/hosts', hostManageRateLimit, async (req: AuthRequest, res) => {
  const parsed = removeHostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Please provide a valid email address.',
    });
  }

  try {
    const instId = req.currentUser!.institutionId;
    const normalizedEmail = parsed.data.email.trim().toLowerCase();

    if (isPrimaryHostEmail(normalizedEmail)) {
      return res.status(403).json({
        error: 'Primary Host accounts cannot be removed.',
      });
    }

    if (normalizedEmail === req.currentUser!.email.trim().toLowerCase()) {
      return res.status(400).json({
        error: 'You cannot remove your own Host access.',
      });
    }

    const [inst] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.id, instId))
      .limit(1);

    if (!inst) {
      return res.status(404).json({ error: 'Institution not found.' });
    }

    const existingAdded: AddedHostEntry[] = Array.isArray(inst.settings?.addedHosts)
      ? inst.settings.addedHosts
      : [];

    const filtered = existingAdded.filter(
      (h) => h.email.trim().toLowerCase() !== normalizedEmail
    );

    if (filtered.length === existingAdded.length) {
      return res.status(404).json({ error: 'Host email was not found.' });
    }

    const nextSettings = {
      ...(inst.settings ?? {}),
      addedHosts: filtered,
    };

    await db
      .update(institutions)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(institutions.id, instId));

    const [existingProfile] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.email, normalizedEmail), eq(profiles.institutionId, instId)))
      .limit(1);

    if (existingProfile) {
      await db
        .update(profiles)
        .set({
          role: 'student',
          serverAdmin: false,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, existingProfile.id));

      await db
        .update(institutionMemberships)
        .set({ membershipRole: 'student' })
        .where(
          and(
            eq(institutionMemberships.userId, existingProfile.id),
            eq(institutionMemberships.institutionId, instId)
          )
        );
    }

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'host.removed',
      targetType: 'host',
      targetId: existingProfile?.id ?? null,
      changedFields: ['role'],
      metadata: { email: normalizedEmail },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[host] remove host error:', err);
    return res.status(500).json({ error: 'Unable to remove host right now.' });
  }
});

export default router;
