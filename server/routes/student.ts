import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  answers,
  assessments,
  gradingRecords,
  questionOptions,
  questions,
  sessions,
  studentPrivateSessionClaims,
  submissions,
} from '../../src/db/schema.ts';
import {
  publicStartSessionSchema,
  publicVerifyQrSchema,
  resolveCodeSchema,
  startSessionSchema,
  submitAssessmentSchema,
  verifyQrSchema,
} from '../../shared/schemas.ts';
import {
  canAcceptSubmission,
  computeEffectiveSessionStatus,
  computeRemainingSeconds,
  computeSubmissionTotals,
  gradeObjectiveQuestion,
  normalizeSixDigitCode,
  parseOfficialQrPayload,
} from '../services/domain.ts';
import {
  generateAnonymousId,
  hashQrToken,
  hashSessionToken,
  signGuestResultToken,
  signSessionAttemptToken,
  timingSafeEqualStrings,
  verifyGuestResultToken,
  verifySessionAttemptToken,
} from '../utils/crypto.ts';
import { createRateLimiter, requireAuth, requireStudent, type AuthRequest } from '../middleware/auth.ts';
import { publishRealtimeEvent } from '../realtime/bus.ts';
import type {
  AssessmentType,
  GradingOutcome,
  PrivacyMode,
  PublicSessionDTO,
  QuestionType,
  SubmissionDetailDTO,
  SubmissionStatus,
  SubmissionSummaryDTO,
} from '../../shared/types.ts';

const router = Router();
const lookupRateLimit = createRateLimiter('session-lookup', 40, 60_000);
const submitRateLimit = createRateLimiter('submission', 20, 60_000);

async function buildPublicSessionPayload(
  sessionId: string,
  studentId: string | null
): Promise<PublicSessionDTO | null> {
  const rows = await db
    .select({ session: sessions, assessment: assessments })
    .from(sessions)
    .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!rows[0]) return null;
  const { session, assessment } = rows[0];
  const now = new Date();
  const effectiveStatus = computeEffectiveSessionStatus(session.status, session.expiresAt, now);

  // Check if this authenticated student has already submitted (Normal mode OR private claim for Anonymous mode)
  let existingSubmissionId: string | null = null;
  if (studentId) {
    if (session.privacyMode === 'normal') {
      const existing = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.sessionId, session.id), eq(submissions.studentId, studentId)))
        .limit(1);
      existingSubmissionId = existing[0]?.id ?? null;
    } else {
      const claim = await db
        .select({ submissionId: studentPrivateSessionClaims.submissionId })
        .from(studentPrivateSessionClaims)
        .where(
          and(
            eq(studentPrivateSessionClaims.sessionId, session.id),
            eq(studentPrivateSessionClaims.studentId, studentId)
          )
        )
        .limit(1);
      existingSubmissionId = claim[0]?.submissionId ?? null;
    }
  }

  const qRows = await db
    .select()
    .from(questions)
    .where(eq(questions.assessmentId, assessment.id))
    .orderBy(questions.position);

  const qIds = qRows.map((q) => q.id);
  const optRows = qIds.length
    ? await db
        .select({
          id: questionOptions.id,
          questionId: questionOptions.questionId,
          position: questionOptions.position,
          label: questionOptions.label,
          // SECURITY INVARIANT: isCorrect is NEVER selected or returned before submission!
        })
        .from(questionOptions)
        .where(inArray(questionOptions.questionId, qIds))
        .orderBy(questionOptions.position)
    : [];

  const optByQ = new Map<string, Array<{ id: string; position: number; label: string }>>();
  for (const o of optRows) {
    const list = optByQ.get(o.questionId) ?? [];
    list.push({ id: o.id, position: o.position, label: o.label });
    optByQ.set(o.questionId, list);
  }

  return {
    sessionId: session.id,
    assessmentId: assessment.id,
    type: assessment.type as AssessmentType,
    title: assessment.title,
    description: assessment.description,
    instructions: assessment.instructions,
    privacyMode: session.privacyMode as PrivacyMode,
    joinCode: session.joinCode,
    expiresAt: session.expiresAt.toISOString(),
    serverTime: now.toISOString(),
    remainingSeconds: effectiveStatus === 'active' ? computeRemainingSeconds(session.expiresAt, now) : 0,
    allowAlias: assessment.settings?.allowAlias !== false,
    showMarksToStudents:
      assessment.type === 'quiz' && assessment.settings?.showMarksToStudents !== false,
    alreadySubmitted: Boolean(existingSubmissionId),
    existingSubmissionId,
    questions: qRows.map((q) => ({
      id: q.id,
      position: q.position,
      type: q.type as QuestionType,
      text: q.text,
      points: assessment.type === 'quiz' ? q.points : 0,
      required: q.settings?.required !== false,
      options: optByQ.get(q.id) ?? [],
    })),
  };
}

// Resolve 6-digit numeric entry code
router.post('/sessions/resolve-code', requireAuth, requireStudent, lookupRateLimit, async (req: AuthRequest, res) => {
  const parsed = resolveCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please enter a valid six-digit session code.' });
  }

  const normalizedCode = normalizeSixDigitCode(parsed.data.code);
  if (!normalizedCode) {
    return res.status(400).json({ error: 'Session code must be exactly 6 numeric digits (e.g., 482910).' });
  }

  try {
    const candidateRows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.joinCode, normalizedCode),
          eq(sessions.institutionId, req.currentUser!.institutionId)
        )
      )
      .orderBy(desc(sessions.launchedAt))
      .limit(3);

    if (!candidateRows.length) {
      return res.status(404).json({
        error: 'No active session matched that six-digit code. Double-check the code with your host.',
        code: 'SESSION_NOT_FOUND',
      });
    }

    const now = new Date();
    const activeSession = candidateRows.find(
      (s) => computeEffectiveSessionStatus(s.status, s.expiresAt, now) === 'active'
    );

    if (!activeSession) {
      const latest = candidateRows[0];
      const st = computeEffectiveSessionStatus(latest.status, latest.expiresAt, now);
      return res.status(410).json({
        error:
          st === 'ended'
            ? 'This session has been ended by the host and is no longer accepting joins.'
            : 'This session has expired. Ask your host to extend or relaunch the session.',
        code: 'SESSION_EXPIRED',
      });
    }

    const payload = await buildPublicSessionPayload(activeSession.id, req.currentUser!.id);
    if (!payload) {
      return res.status(404).json({ error: 'Session details could not be loaded.' });
    }
    return res.json({ session: payload });
  } catch (err) {
    console.error('[student] resolve-code error:', err);
    return res.status(500).json({ error: 'Unable to look up session code right now.' });
  }
});

// Verify official ThinkPulse QR payload against active session and current QR token hash
router.post('/sessions/verify-qr', requireAuth, requireStudent, lookupRateLimit, async (req: AuthRequest, res) => {
  const parsed = verifyQrSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'QR code payload is empty or unreadable.' });
  }

  const decoded = parseOfficialQrPayload(parsed.data.payload);
  if (!decoded) {
    return res.status(400).json({
      error: 'This QR code is not a valid ThinkPulse session QR. Ask your host for the official QR or enter the 6-digit code manually.',
      code: 'QR_INVALID',
    });
  }

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, decoded.sessionId),
          eq(sessions.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found for this QR code within your institution.',
        code: 'QR_INVALID',
      });
    }

    const now = new Date();
    const effective = computeEffectiveSessionStatus(session.status, session.expiresAt, now);
    if (effective !== 'active') {
      return res.status(410).json({
        error:
          effective === 'ended'
            ? 'This session has ended. Ask your host if a new session has been launched.'
            : 'This session QR has expired. Ask your host to extend or relaunch.',
        code: 'QR_EXPIRED',
      });
    }

    const suppliedHash = hashQrToken(decoded.token);
    if (!timingSafeEqualStrings(suppliedHash, session.qrTokenHash)) {
      return res.status(409).json({
        error: 'This QR code has been rotated or revoked by the host. Please scan the latest QR code on screen or enter the 6-digit code.',
        code: 'QR_SUPERSEDED',
      });
    }

    const payload = await buildPublicSessionPayload(session.id, req.currentUser!.id);
    if (!payload) {
      return res.status(404).json({ error: 'Session could not be loaded.' });
    }
    return res.json({ session: payload });
  } catch (err) {
    console.error('[student] verify-qr error:', err);
    return res.status(500).json({ error: 'Could not verify QR code.' });
  }
});

// Load sanitized public session details
router.get('/sessions/:id/public', requireAuth, requireStudent, async (req: AuthRequest, res) => {
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, req.params.id),
          eq(sessions.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const effective = computeEffectiveSessionStatus(session.status, session.expiresAt);
    const payload = await buildPublicSessionPayload(session.id, req.currentUser!.id);
    if (!payload) return res.status(404).json({ error: 'Session not found.' });

    if (effective !== 'active' && !payload.alreadySubmitted) {
      return res.status(410).json({
        error: 'This session is no longer active.',
        code: 'SESSION_EXPIRED',
        session: payload,
      });
    }

    return res.json({ session: payload });
  } catch (err) {
    console.error('[student] get public session error:', err);
    return res.status(500).json({ error: 'Unable to load session.' });
  }
});

// Start a session attempt — mints server-signed session attempt token + random anonId if Anonymous mode
router.post('/sessions/:id/start', requireAuth, requireStudent, async (req: AuthRequest, res) => {
  const parsed = startSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid alias or start payload.' });
  }

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, req.params.id),
          eq(sessions.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const now = new Date();
    const effective = computeEffectiveSessionStatus(session.status, session.expiresAt, now);
    if (effective !== 'active') {
      return res.status(410).json({
        error: 'This session has expired or ended and cannot be started.',
        code: 'SESSION_EXPIRED',
      });
    }

    const studentId = req.currentUser!.id;
    const mode = session.privacyMode as PrivacyMode;

    // Duplicate submission check before starting
    if (mode === 'normal') {
      const existing = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.sessionId, session.id), eq(submissions.studentId, studentId)))
        .limit(1);
      if (existing[0]) {
        return res.status(409).json({
          error: 'You have already submitted a response for this session.',
          code: 'ALREADY_SUBMITTED',
          submissionId: existing[0].id,
        });
      }
    } else {
      const claim = await db
        .select({ submissionId: studentPrivateSessionClaims.submissionId })
        .from(studentPrivateSessionClaims)
        .where(
          and(
            eq(studentPrivateSessionClaims.sessionId, session.id),
            eq(studentPrivateSessionClaims.studentId, studentId)
          )
        )
        .limit(1);
      if (claim[0]) {
        return res.status(409).json({
          error: 'You have already submitted an anonymous response for this session.',
          code: 'ALREADY_SUBMITTED',
          submissionId: claim[0].submissionId,
        });
      }
    }

    const anonId = mode === 'anonymous' ? generateAnonymousId() : undefined;
    const sessionToken = signSessionAttemptToken({
      sid: session.id,
      mode,
      anonId,
      studentId: mode === 'normal' ? studentId : undefined,
      startedAt: now.toISOString(),
    });

    return res.json({
      sessionToken,
      privacyMode: mode,
      anonId: anonId ?? null,
      alias: mode === 'anonymous' ? parsed.data.alias?.trim() || null : null,
      startedAt: now.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      serverTime: now.toISOString(),
    });
  } catch (err) {
    console.error('[student] start session error:', err);
    return res.status(500).json({ error: 'Failed to start session.' });
  }
});

// Submit answers atomically (idempotent, server-graded, privacy-enforced)
router.post('/sessions/:id/submissions', requireAuth, requireStudent, submitRateLimit, async (req: AuthRequest, res) => {
  const parsed = submitAssessmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid submission payload.',
    });
  }

  const attempt = verifySessionAttemptToken(parsed.data.sessionToken);
  if (!attempt || attempt.sid !== req.params.id) {
    return res.status(400).json({
      error: 'Invalid or expired session attempt token. Please rejoin the session.',
    });
  }

  try {
    const rows = await db
      .select({ session: sessions, assessment: assessments })
      .from(sessions)
      .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
      .where(
        and(
          eq(sessions.id, req.params.id),
          eq(sessions.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    const { session, assessment } = rows[0];

    const now = new Date();
    const startedAt = new Date(attempt.startedAt);
    const windowCheck = canAcceptSubmission({
      sessionStatus: session.status,
      expiresAt: session.expiresAt,
      startedAt,
      autoSubmitted: parsed.data.autoSubmitted,
      now,
    });
    if (!windowCheck.allowed) {
      return res.status(410).json({ error: windowCheck.reason, code: 'SESSION_EXPIRED' });
    }

    const studentId = req.currentUser!.id;
    const mode = session.privacyMode as PrivacyMode;
    const tokenHash = hashSessionToken(
      mode === 'normal' ? `normal:${session.id}:${studentId}` : parsed.data.sessionToken
    );

    // Idempotency / duplicate-submission check
    if (mode === 'normal') {
      const existing = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.sessionId, session.id), eq(submissions.studentId, studentId)))
        .limit(1);
      if (existing[0]) {
        return res.status(409).json({
          error: 'Duplicate submission prevented: your response was already recorded.',
          code: 'DUPLICATE_SUBMISSION',
          submissionId: existing[0].id,
        });
      }
    } else {
      const claim = await db
        .select({ submissionId: studentPrivateSessionClaims.submissionId })
        .from(studentPrivateSessionClaims)
        .where(
          and(
            eq(studentPrivateSessionClaims.sessionId, session.id),
            eq(studentPrivateSessionClaims.studentId, studentId)
          )
        )
        .limit(1);
      if (claim[0]) {
        return res.status(409).json({
          error: 'Duplicate submission prevented: you already submitted an anonymous response for this session.',
          code: 'DUPLICATE_SUBMISSION',
          submissionId: claim[0].submissionId,
        });
      }
    }

    // Load authoritative published questions & options
    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessment.id))
      .orderBy(questions.position);
    const qMap = new Map(qRows.map((q) => [q.id, q]));

    const optRows = qRows.length
      ? await db
          .select()
          .from(questionOptions)
          .where(inArray(questionOptions.questionId, qRows.map((q) => q.id)))
      : [];
    const optionsByQuestion = new Map<string, Array<typeof questionOptions.$inferSelect>>();
    for (const o of optRows) {
      const list = optionsByQuestion.get(o.questionId) ?? [];
      list.push(o);
      optionsByQuestion.set(o.questionId, list);
    }

    // Validate submitted questionIds belong to this assessment & optionIds belong to each question
    const answerByQuestion = new Map<string, { selectedOptionIds: string[]; textAnswer: string | null }>();
    for (const a of parsed.data.answers) {
      const q = qMap.get(a.questionId);
      if (!q) {
        return res.status(400).json({ error: 'Submission contains an invalid question ID.' });
      }
      const validOptSet = new Set((optionsByQuestion.get(q.id) ?? []).map((o) => o.id));
      const cleanedOptIds = Array.from(new Set(a.selectedOptionIds)).filter((id) => validOptSet.has(id));
      if (cleanedOptIds.length !== new Set(a.selectedOptionIds).size) {
        return res.status(400).json({ error: 'Submission contains an invalid option ID.' });
      }
      if (q.type === 'mcq' && cleanedOptIds.length > 1) {
        return res.status(400).json({ error: 'Single-choice questions accept at most one option.' });
      }
      answerByQuestion.set(q.id, {
        selectedOptionIds: cleanedOptIds,
        textAnswer: a.textAnswer?.trim() || null,
      });
    }

    // Compute grading server-side (only for Quiz; Polls have zero marks & no grading records)
    const gradingRowsToInsert: Array<{
      questionId: string;
      awardedPoints: number;
      maxPoints: number;
      outcome: GradingOutcome;
    }> = [];

    let totalScore = 0;
    let maxScore = 0;
    let submissionStatus: SubmissionStatus = 'submitted';

    if (assessment.type === 'quiz') {
      for (const q of qRows) {
        const ans = answerByQuestion.get(q.id);
        const correctOptionIds = (optionsByQuestion.get(q.id) ?? [])
          .filter((o) => o.isCorrect)
          .map((o) => o.id);

        const resGrade = gradeObjectiveQuestion(
          {
            id: q.id,
            type: q.type as QuestionType,
            points: q.points,
            partialCredit: Boolean(q.settings?.partialCredit),
            correctOptionIds,
          },
          ans?.selectedOptionIds ?? []
        );

        gradingRowsToInsert.push({
          questionId: q.id,
          awardedPoints: resGrade.awardedPoints,
          maxPoints: resGrade.maxPoints,
          outcome: resGrade.outcome,
        });
      }

      const totals = computeSubmissionTotals(gradingRowsToInsert);
      totalScore = totals.totalScore;
      maxScore = totals.maxScore;
      submissionStatus = totals.status;
    }

    // Atomic transaction: insert submission + answers + grading_records (+ private claim for Anonymous mode)
    const createdSubmission = await db.transaction(async (tx) => {
      const [sub] = await tx
        .insert(submissions)
        .values({
          assessmentId: assessment.id,
          sessionId: session.id,
          institutionId: session.institutionId,
          privacyMode: mode,
          // STRICT PRIVACY INVARIANT: studentId is ALWAYS null in Anonymous mode!
          studentId: mode === 'normal' ? studentId : null,
          anonId: mode === 'anonymous' ? attempt.anonId || generateAnonymousId() : null,
          alias:
            mode === 'anonymous' && assessment.settings?.allowAlias !== false
              ? parsed.data.alias?.trim() || null
              : null,
          sessionTokenHash: tokenHash,
          status: submissionStatus,
          totalScore,
          maxScore,
          autoSubmitted: parsed.data.autoSubmitted,
          startedAt,
          submittedAt: now,
        })
        .returning();

      if (qRows.length > 0) {
        await tx.insert(answers).values(
          qRows.map((q) => {
            const ans = answerByQuestion.get(q.id);
            return {
              submissionId: sub.id,
              questionId: q.id,
              selectedOptionIds: ans?.selectedOptionIds ?? [],
              textAnswer: ans?.textAnswer ?? null,
            };
          })
        );
      }

      if (assessment.type === 'quiz' && gradingRowsToInsert.length > 0) {
        await tx.insert(gradingRecords).values(
          gradingRowsToInsert.map((g) => ({
            submissionId: sub.id,
            questionId: g.questionId,
            awardedPoints: g.awardedPoints,
            maxPoints: g.maxPoints,
            outcome: g.outcome,
            manuallyGraded: false,
          }))
        );
      }

      // Restricted private claim so authenticated student can view their own Anonymous result later
      if (mode === 'anonymous') {
        await tx.insert(studentPrivateSessionClaims).values({
          studentId,
          sessionId: session.id,
          submissionId: sub.id,
        });
      }

      return sub;
    });

    // Publish real-time updates to host (NEVER leaking student identity for Anonymous mode!)
    publishRealtimeEvent({
      type: 'submission.created',
      institutionId: session.institutionId,
      assessmentId: assessment.id,
      sessionId: session.id,
      submissionId: createdSubmission.id,
      payload: {
        assessmentType: assessment.type,
        privacyMode: mode,
        status: createdSubmission.status,
      },
    });

    if (assessment.type === 'poll') {
      publishRealtimeEvent({
        type: 'poll.responses_updated',
        institutionId: session.institutionId,
        assessmentId: assessment.id,
        sessionId: session.id,
        payload: { sessionId: session.id },
      });
    }

    return res.status(201).json({
      submissionId: createdSubmission.id,
      status: createdSubmission.status,
      totalScore: createdSubmission.totalScore,
      maxScore: createdSubmission.maxScore,
      anonId: createdSubmission.anonId,
    });
  } catch (err: unknown) {
    console.error('[student] submit error:', err);
    return res.status(500).json({ error: 'Unable to save submission. Please try again.' });
  }
});

// List student's own recent submissions (Normal mode + restricted private claims for Anonymous mode)
router.get('/my/submissions', requireAuth, requireStudent, async (req: AuthRequest, res) => {
  try {
    const studentId = req.currentUser!.id;

    // 1. Normal-mode submissions directly linked to studentId
    const normalRows = await db
      .select({
        sub: submissions,
        assessmentTitle: assessments.title,
        assessmentType: assessments.type,
        joinCode: sessions.joinCode,
      })
      .from(submissions)
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      .where(eq(submissions.studentId, studentId))
      .orderBy(desc(submissions.submittedAt))
      .limit(50);

    // 2. Anonymous-mode submissions linked strictly via private student claim table
    const anonRows = await db
      .select({
        sub: submissions,
        assessmentTitle: assessments.title,
        assessmentType: assessments.type,
        joinCode: sessions.joinCode,
      })
      .from(studentPrivateSessionClaims)
      .innerJoin(submissions, eq(studentPrivateSessionClaims.submissionId, submissions.id))
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      .where(eq(studentPrivateSessionClaims.studentId, studentId))
      .orderBy(desc(submissions.submittedAt))
      .limit(50);

    const merged = [...normalRows, ...anonRows].sort(
      (a, b) => b.sub.submittedAt.getTime() - a.sub.submittedAt.getTime()
    );

    const items: SubmissionSummaryDTO[] = merged.map((r) => ({
      id: r.sub.id,
      assessmentId: r.sub.assessmentId,
      assessmentTitle: r.assessmentTitle,
      assessmentType: r.assessmentType as AssessmentType,
      sessionId: r.sub.sessionId,
      joinCode: r.joinCode,
      privacyMode: r.sub.privacyMode as PrivacyMode,
      participantLabel:
        r.sub.privacyMode === 'anonymous'
          ? r.sub.alias
            ? `${r.sub.anonId} (${r.sub.alias})`
            : r.sub.anonId || 'Anonymous'
          : req.currentUser!.displayName,
      anonId: r.sub.anonId,
      alias: r.sub.alias,
      status: r.sub.status as SubmissionStatus,
      totalScore: r.sub.totalScore,
      maxScore: r.sub.maxScore,
      percentage:
        r.assessmentType === 'quiz' && r.sub.maxScore > 0
          ? Math.round((r.sub.totalScore / r.sub.maxScore) * 1000) / 10
          : null,
      autoSubmitted: r.sub.autoSubmitted,
      submittedAt: r.sub.submittedAt.toISOString(),
    }));

    return res.json({ submissions: items });
  } catch (err) {
    console.error('[student] list my submissions error:', err);
    return res.status(500).json({ error: 'Unable to load your recent sessions.' });
  }
});

// Get detailed result for one of the student's OWN submissions
router.get('/my/submissions/:id', requireAuth, requireStudent, async (req: AuthRequest, res) => {
  try {
    const studentId = req.currentUser!.id;
    const rows = await db
      .select({
        sub: submissions,
        assessment: assessments,
        session: sessions,
      })
      .from(submissions)
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      .where(eq(submissions.id, req.params.id))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Submission not found.' });
    const { sub, assessment, session } = rows[0];

    // Verify ownership (Normal mode: studentId matches; Anonymous mode: private claim matches)
    let authorized = false;
    if (sub.privacyMode === 'normal' && sub.studentId === studentId) {
      authorized = true;
    } else if (sub.privacyMode === 'anonymous') {
      const claim = await db
        .select({ id: studentPrivateSessionClaims.id })
        .from(studentPrivateSessionClaims)
        .where(
          and(
            eq(studentPrivateSessionClaims.submissionId, sub.id),
            eq(studentPrivateSessionClaims.studentId, studentId)
          )
        )
        .limit(1);
      authorized = Boolean(claim[0]);
    }

    if (!authorized) {
      return res.status(403).json({
        error: 'You do not have permission to view another student’s submission.',
      });
    }

    const detail = await buildSubmissionDetailDTO(sub, assessment, session, req.currentUser!.displayName);
    return res.json({ submission: detail });
  } catch (err) {
    console.error('[student] get submission detail error:', err);
    return res.status(500).json({ error: 'Unable to load submission result.' });
  }
});

async function buildSubmissionDetailDTO(
  sub: typeof submissions.$inferSelect,
  assessment: typeof assessments.$inferSelect,
  session: typeof sessions.$inferSelect,
  normalParticipantName: string
): Promise<SubmissionDetailDTO> {
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
  const gradeRows =
    assessment.type === 'quiz'
      ? await db.select().from(gradingRecords).where(eq(gradingRecords.submissionId, sub.id))
      : [];

  const ansMap = new Map(ansRows.map((a) => [a.questionId, a]));
  const gradeMap = new Map(gradeRows.map((g) => [g.questionId, g]));
  const optMap = new Map<string, Array<{ id: string; label: string; isCorrect?: boolean }>>();
  for (const o of optRows) {
    const list = optMap.get(o.questionId) ?? [];
    list.push({
      id: o.id,
      label: o.label,
      ...(assessment.type === 'quiz' ? { isCorrect: o.isCorrect } : {}),
    });
    optMap.set(o.questionId, list);
  }

  return {
    id: sub.id,
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    assessmentType: assessment.type as AssessmentType,
    sessionId: session.id,
    joinCode: session.joinCode,
    privacyMode: sub.privacyMode as PrivacyMode,
    participantLabel:
      sub.privacyMode === 'anonymous'
        ? sub.alias
          ? `${sub.anonId} (${sub.alias})`
          : sub.anonId || 'Anonymous'
        : normalParticipantName,
    anonId: sub.anonId,
    alias: sub.alias,
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
}

// ============================================================================
// PUBLIC GUEST QR ENDPOINTS — STRICTLY ANONYMOUS-MODE QR SESSIONS ONLY
// Normal-mode sessions are unconditionally rejected and require Google Sign-In.
// ============================================================================

// 1. Verify host-generated QR link for an Anonymous quiz/poll (no Google Sign-In)
router.post('/public/sessions/verify-qr', lookupRateLimit, async (req: AuthRequest, res) => {
  const parsed = publicVerifyQrSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'This QR link is incomplete or invalid. Please scan the official QR code again.',
      code: 'QR_INVALID',
    });
  }

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, parsed.data.sid))
      .limit(1);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found for this QR code.',
        code: 'QR_INVALID',
      });
    }

    // Verify cryptographic QR token first using timing-safe comparison
    const suppliedHash = hashQrToken(parsed.data.token);
    if (!timingSafeEqualStrings(suppliedHash, session.qrTokenHash)) {
      return res.status(409).json({
        error: 'This QR code has been rotated or revoked by the host. Please scan the latest QR code on screen.',
        code: 'QR_SUPERSEDED',
      });
    }

    // STRICT INVARIANT: Direct QR entry without Google Sign-In is ONLY allowed for Anonymous mode
    if (session.privacyMode !== 'anonymous') {
      return res.status(403).json({
        error: 'This session requires Google Sign-In. Only anonymous quizzes and polls can be opened directly via QR.',
        code: 'SIGN_IN_REQUIRED',
      });
    }

    const now = new Date();
    const effective = computeEffectiveSessionStatus(session.status, session.expiresAt, now);
    if (effective !== 'active') {
      return res.status(410).json({
        error:
          effective === 'ended'
            ? 'This session has ended. Ask your host if a new session has been launched.'
            : 'This session QR has expired. Ask your host to extend or relaunch.',
        code: 'QR_EXPIRED',
      });
    }

    const payload = await buildPublicSessionPayload(session.id, null);
    if (!payload) {
      return res.status(404).json({ error: 'Session could not be loaded.' });
    }

    return res.json({ session: payload });
  } catch (err) {
    console.error('[public] verify-qr error:', err);
    return res.status(500).json({ error: 'Unable to verify QR code right now.' });
  }
});

// 2. Start an anonymous guest attempt (requires active QR token + anonymous mode)
router.post('/public/sessions/:id/start', lookupRateLimit, async (req: AuthRequest, res) => {
  const parsed = publicStartSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid QR token or alias.' });
  }

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, req.params.id))
      .limit(1);

    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const suppliedHash = hashQrToken(parsed.data.qrToken);
    if (!timingSafeEqualStrings(suppliedHash, session.qrTokenHash)) {
      return res.status(409).json({
        error: 'This QR code has been rotated by the host. Please scan the latest QR code.',
        code: 'QR_SUPERSEDED',
      });
    }

    if (session.privacyMode !== 'anonymous') {
      return res.status(403).json({
        error: 'This session requires Google Sign-In. Only anonymous quizzes and polls support direct QR participation.',
        code: 'SIGN_IN_REQUIRED',
      });
    }

    const now = new Date();
    const effective = computeEffectiveSessionStatus(session.status, session.expiresAt, now);
    if (effective !== 'active') {
      return res.status(410).json({
        error: 'This session has expired or ended and cannot be started.',
        code: 'SESSION_EXPIRED',
      });
    }

    const anonId = generateAnonymousId();
    const sessionToken = signSessionAttemptToken({
      sid: session.id,
      mode: 'anonymous',
      anonId,
      guest: true,
      startedAt: now.toISOString(),
    });

    return res.json({
      sessionToken,
      privacyMode: 'anonymous' as const,
      anonId,
      alias: parsed.data.alias?.trim() || null,
      startedAt: now.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      serverTime: now.toISOString(),
    });
  } catch (err) {
    console.error('[public] start session error:', err);
    return res.status(500).json({ error: 'Failed to start anonymous session.' });
  }
});

// 3. Submit an anonymous guest response (strictly anonymous + guest attempt token)
router.post('/public/sessions/:id/submissions', submitRateLimit, async (req: AuthRequest, res) => {
  const parsed = submitAssessmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid submission payload.',
    });
  }

  const attempt = verifySessionAttemptToken(parsed.data.sessionToken);
  if (!attempt || attempt.sid !== req.params.id || attempt.mode !== 'anonymous' || !attempt.guest) {
    return res.status(400).json({
      error: 'Invalid or expired anonymous session token. Please scan the QR code again.',
    });
  }

  try {
    const rows = await db
      .select({ session: sessions, assessment: assessments })
      .from(sessions)
      .innerJoin(assessments, eq(sessions.assessmentId, assessments.id))
      .where(eq(sessions.id, req.params.id))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    const { session, assessment } = rows[0];

    if (session.privacyMode !== 'anonymous') {
      return res.status(403).json({
        error: 'This session requires Google Sign-In.',
        code: 'SIGN_IN_REQUIRED',
      });
    }

    const now = new Date();
    const startedAt = new Date(attempt.startedAt);
    const windowCheck = canAcceptSubmission({
      sessionStatus: session.status,
      expiresAt: session.expiresAt,
      startedAt,
      autoSubmitted: parsed.data.autoSubmitted,
      now,
    });
    if (!windowCheck.allowed) {
      return res.status(410).json({ error: windowCheck.reason, code: 'SESSION_EXPIRED' });
    }

    const tokenHash = hashSessionToken(parsed.data.sessionToken);
    const existing = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.sessionId, session.id), eq(submissions.sessionTokenHash, tokenHash)))
      .limit(1);
    if (existing[0]) {
      return res.status(409).json({
        error: 'Duplicate submission prevented: your response was already recorded.',
        code: 'DUPLICATE_SUBMISSION',
        submissionId: existing[0].id,
      });
    }

    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessment.id))
      .orderBy(questions.position);
    const qMap = new Map(qRows.map((q) => [q.id, q]));

    const optRows = qRows.length
      ? await db
          .select()
          .from(questionOptions)
          .where(inArray(questionOptions.questionId, qRows.map((q) => q.id)))
      : [];
    const optionsByQuestion = new Map<string, Array<typeof questionOptions.$inferSelect>>();
    for (const o of optRows) {
      const list = optionsByQuestion.get(o.questionId) ?? [];
      list.push(o);
      optionsByQuestion.set(o.questionId, list);
    }

    const answerByQuestion = new Map<string, { selectedOptionIds: string[]; textAnswer: string | null }>();
    for (const a of parsed.data.answers) {
      const q = qMap.get(a.questionId);
      if (!q) {
        return res.status(400).json({ error: 'Submission contains an invalid question ID.' });
      }
      const validOptSet = new Set((optionsByQuestion.get(q.id) ?? []).map((o) => o.id));
      const cleanedOptIds = Array.from(new Set(a.selectedOptionIds)).filter((id) => validOptSet.has(id));
      if (cleanedOptIds.length !== new Set(a.selectedOptionIds).size) {
        return res.status(400).json({ error: 'Submission contains an invalid option ID.' });
      }
      if (q.type === 'mcq' && cleanedOptIds.length > 1) {
        return res.status(400).json({ error: 'Single-choice questions accept at most one option.' });
      }
      answerByQuestion.set(q.id, {
        selectedOptionIds: cleanedOptIds,
        textAnswer: a.textAnswer?.trim() || null,
      });
    }

    const gradingRowsToInsert: Array<{
      questionId: string;
      awardedPoints: number;
      maxPoints: number;
      outcome: GradingOutcome;
    }> = [];

    let totalScore = 0;
    let maxScore = 0;
    let submissionStatus: SubmissionStatus = 'submitted';

    if (assessment.type === 'quiz') {
      for (const q of qRows) {
        const ans = answerByQuestion.get(q.id);
        const correctOptionIds = (optionsByQuestion.get(q.id) ?? [])
          .filter((o) => o.isCorrect)
          .map((o) => o.id);

        const resGrade = gradeObjectiveQuestion(
          {
            id: q.id,
            type: q.type as QuestionType,
            points: q.points,
            partialCredit: Boolean(q.settings?.partialCredit),
            correctOptionIds,
          },
          ans?.selectedOptionIds ?? []
        );

        gradingRowsToInsert.push({
          questionId: q.id,
          awardedPoints: resGrade.awardedPoints,
          maxPoints: resGrade.maxPoints,
          outcome: resGrade.outcome,
        });
      }

      const totals = computeSubmissionTotals(gradingRowsToInsert);
      totalScore = totals.totalScore;
      maxScore = totals.maxScore;
      submissionStatus = totals.status;
    }

    const createdSubmission = await db.transaction(async (tx) => {
      const [sub] = await tx
        .insert(submissions)
        .values({
          assessmentId: assessment.id,
          sessionId: session.id,
          institutionId: session.institutionId,
          privacyMode: 'anonymous',
          studentId: null,
          anonId: attempt.anonId || generateAnonymousId(),
          alias:
            assessment.settings?.allowAlias !== false
              ? parsed.data.alias?.trim() || null
              : null,
          sessionTokenHash: tokenHash,
          status: submissionStatus,
          totalScore,
          maxScore,
          autoSubmitted: parsed.data.autoSubmitted,
          startedAt,
          submittedAt: now,
        })
        .returning();

      if (qRows.length > 0) {
        await tx.insert(answers).values(
          qRows.map((q) => {
            const ans = answerByQuestion.get(q.id);
            return {
              submissionId: sub.id,
              questionId: q.id,
              selectedOptionIds: ans?.selectedOptionIds ?? [],
              textAnswer: ans?.textAnswer ?? null,
            };
          })
        );
      }

      if (assessment.type === 'quiz' && gradingRowsToInsert.length > 0) {
        await tx.insert(gradingRecords).values(
          gradingRowsToInsert.map((g) => ({
            submissionId: sub.id,
            questionId: g.questionId,
            awardedPoints: g.awardedPoints,
            maxPoints: g.maxPoints,
            outcome: g.outcome,
            manuallyGraded: false,
          }))
        );
      }

      return sub;
    });

    publishRealtimeEvent({
      type: 'submission.created',
      institutionId: session.institutionId,
      assessmentId: assessment.id,
      sessionId: session.id,
      submissionId: createdSubmission.id,
      payload: {
        assessmentType: assessment.type,
        privacyMode: 'anonymous',
        status: createdSubmission.status,
      },
    });

    if (assessment.type === 'poll') {
      publishRealtimeEvent({
        type: 'poll.responses_updated',
        institutionId: session.institutionId,
        assessmentId: assessment.id,
        sessionId: session.id,
        payload: { sessionId: session.id },
      });
    }

    const resultToken = signGuestResultToken({
      subId: createdSubmission.id,
      sid: session.id,
    });

    return res.status(201).json({
      submissionId: createdSubmission.id,
      status: createdSubmission.status,
      totalScore: createdSubmission.totalScore,
      maxScore: createdSubmission.maxScore,
      anonId: createdSubmission.anonId,
      resultToken,
    });
  } catch (err) {
    console.error('[public] submit error:', err);
    return res.status(500).json({ error: 'Unable to save anonymous submission. Please try again.' });
  }
});

// 4. View guest's own anonymous result using HMAC-signed X-Result-Token
router.get('/public/submissions/:id', lookupRateLimit, async (req: AuthRequest, res) => {
  const token = req.get('x-result-token')?.trim() || '';
  const receipt = verifyGuestResultToken(token);
  if (!receipt || receipt.subId !== req.params.id) {
    return res.status(403).json({
      error: 'Valid submission receipt token is required to view this result.',
    });
  }

  try {
    const rows = await db
      .select({
        sub: submissions,
        assessment: assessments,
        session: sessions,
      })
      .from(submissions)
      .innerJoin(assessments, eq(submissions.assessmentId, assessments.id))
      .innerJoin(sessions, eq(submissions.sessionId, sessions.id))
      .where(eq(submissions.id, req.params.id))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: 'Submission not found.' });
    const { sub, assessment, session } = rows[0];

    if (sub.privacyMode !== 'anonymous' || sub.studentId !== null || sub.sessionId !== receipt.sid) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const detail = await buildSubmissionDetailDTO(sub, assessment, session, 'Anonymous');
    return res.json({ submission: detail });
  } catch (err) {
    console.error('[public] get submission detail error:', err);
    return res.status(500).json({ error: 'Unable to load submission result.' });
  }
});

export default router;
