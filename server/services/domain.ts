import type {
  GradingOutcome,
  PollAnalyticsDTO,
  PollQuestionAggregateDTO,
  PrivacyMode,
  QuestionType,
  SessionStatus,
  SubmissionStatus,
} from '../../shared/types.ts';

export const AUTO_SUBMIT_GRACE_SECONDS = 15;

export function normalizeSixDigitCode(raw: string): string | null {
  const digits = raw.replace(/\s|-/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  return digits;
}

export function computeEffectiveSessionStatus(
  status: string,
  expiresAt: Date,
  now: Date = new Date()
): SessionStatus {
  if (status === 'ended') return 'ended';
  if (status === 'expired' || now.getTime() >= expiresAt.getTime()) return 'expired';
  return 'active';
}

export function computeRemainingSeconds(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * Authoritative server-clock submission window validation.
 * Allows a narrowly bounded 15-second grace window ONLY for timer-triggered auto-submission
 * where the participant genuinely started the session BEFORE expiry.
 */
export function canAcceptSubmission(params: {
  sessionStatus: string;
  expiresAt: Date;
  startedAt: Date;
  autoSubmitted: boolean;
  now?: Date;
  graceSeconds?: number;
}): { allowed: boolean; reason?: string } {
  const now = params.now ?? new Date();
  const graceSeconds = params.graceSeconds ?? AUTO_SUBMIT_GRACE_SECONDS;

  if (params.sessionStatus === 'ended') {
    return { allowed: false, reason: 'This session was ended by the host.' };
  }

  if (now.getTime() <= params.expiresAt.getTime()) {
    return { allowed: true };
  }

  // Strictly bounded grace window only when started before expiry AND autoSubmitted flag is true
  const graceDeadline = params.expiresAt.getTime() + graceSeconds * 1000;
  if (
    params.autoSubmitted &&
    params.startedAt.getTime() < params.expiresAt.getTime() &&
    now.getTime() <= graceDeadline
  ) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'This session has expired and no longer accepts submissions.' };
}

export interface GradeableQuestion {
  id: string;
  type: QuestionType;
  points: number;
  partialCredit: boolean;
  correctOptionIds: string[];
}

export interface GradeResult {
  awardedPoints: number;
  maxPoints: number;
  outcome: GradingOutcome;
  requiresManualReview: boolean;
}

export function gradeObjectiveQuestion(
  question: GradeableQuestion,
  selectedOptionIds: string[]
): GradeResult {
  const maxPoints = Math.max(0, Number(question.points) || 0);

  if (question.type === 'short_answer' || question.type === 'paragraph') {
    return {
      awardedPoints: 0,
      maxPoints,
      outcome: 'pending',
      requiresManualReview: true,
    };
  }

  const uniqueSelected = Array.from(new Set(selectedOptionIds));
  const correctSet = new Set(question.correctOptionIds);

  if (correctSet.size === 0) {
    return { awardedPoints: 0, maxPoints, outcome: 'incorrect', requiresManualReview: false };
  }

  const exactMatch =
    uniqueSelected.length === correctSet.size &&
    uniqueSelected.every((id) => correctSet.has(id));

  if (exactMatch) {
    return { awardedPoints: maxPoints, maxPoints, outcome: 'correct', requiresManualReview: false };
  }

  if (question.type === 'multi_select' && question.partialCredit) {
    const correctSelected = uniqueSelected.filter((id) => correctSet.has(id)).length;
    const wrongSelected = uniqueSelected.filter((id) => !correctSet.has(id)).length;
    const rawRatio = Math.max(0, (correctSelected - wrongSelected) / correctSet.size);
    const awarded = Math.round(rawRatio * maxPoints * 100) / 100;
    if (awarded > 0 && awarded < maxPoints) {
      return { awardedPoints: awarded, maxPoints, outcome: 'partial', requiresManualReview: false };
    }
    if (awarded >= maxPoints) {
      return { awardedPoints: maxPoints, maxPoints, outcome: 'correct', requiresManualReview: false };
    }
  }

  return { awardedPoints: 0, maxPoints, outcome: 'incorrect', requiresManualReview: false };
}

export function computeSubmissionTotals(
  records: Array<{ awardedPoints: number; maxPoints: number; outcome: string }>
): { totalScore: number; maxScore: number; status: SubmissionStatus } {
  let totalScore = 0;
  let maxScore = 0;
  let hasPending = false;

  for (const r of records) {
    totalScore += Number(r.awardedPoints) || 0;
    maxScore += Number(r.maxPoints) || 0;
    if (r.outcome === 'pending') hasPending = true;
  }

  totalScore = Math.round(totalScore * 100) / 100;
  maxScore = Math.round(maxScore * 100) / 100;

  return {
    totalScore,
    maxScore,
    status: hasPending ? 'pending_review' : 'reviewed',
  };
}

export interface PollAggregationInput {
  assessmentId: string;
  title: string;
  privacyMode: PrivacyMode;
  questions: Array<{
    id: string;
    position: number;
    type: QuestionType;
    text: string;
    options: Array<{ id: string; position: number; label: string }>;
  }>;
  submissions: Array<{
    id: string;
    participantLabel: string;
    submittedAt: string;
    answers: Array<{
      questionId: string;
      selectedOptionIds: string[];
      textAnswer: string | null;
    }>;
  }>;
}

export function aggregatePollResults(input: PollAggregationInput): PollAnalyticsDTO {
  const totalUniqueRespondents = input.submissions.length;

  const questionAggs: PollQuestionAggregateDTO[] = input.questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      const optionCounts = new Map<string, number>();
      q.options.forEach((o) => optionCounts.set(o.id, 0));

      let respondentCount = 0;
      let totalSelections = 0;
      const textResponses: Array<{ participantLabel: string; text: string; submittedAt: string }> = [];

      for (const sub of input.submissions) {
        const ans = sub.answers.find((a) => a.questionId === q.id);
        if (!ans) continue;

        if (q.type === 'mcq' || q.type === 'multi_select') {
          const validIds = Array.from(new Set(ans.selectedOptionIds)).filter((id) => optionCounts.has(id));
          if (validIds.length > 0) {
            respondentCount += 1;
            totalSelections += validIds.length;
            for (const oid of validIds) {
              optionCounts.set(oid, (optionCounts.get(oid) ?? 0) + 1);
            }
          }
        } else {
          const txt = (ans.textAnswer ?? '').trim();
          if (txt.length > 0) {
            respondentCount += 1;
            textResponses.push({
              participantLabel: sub.participantLabel,
              text: txt,
              submittedAt: sub.submittedAt,
            });
          }
        }
      }

      const noResponseCount = Math.max(0, totalUniqueRespondents - respondentCount);
      const maxVotes = Math.max(0, ...Array.from(optionCounts.values()));
      const topLabels: string[] = [];

      const options = q.options
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((o) => {
          const votes = optionCounts.get(o.id) ?? 0;
          const respondentPercentage =
            respondentCount > 0 ? Math.round((votes / respondentCount) * 1000) / 10 : 0;
          const selectionSharePercentage =
            totalSelections > 0 ? Math.round((votes / totalSelections) * 1000) / 10 : 0;
          const isTop = maxVotes > 0 && votes === maxVotes;
          if (isTop) topLabels.push(o.label);
          return {
            optionId: o.id,
            label: o.label,
            votes,
            respondentPercentage,
            selectionSharePercentage,
            isTop,
          };
        });

      return {
        questionId: q.id,
        position: q.position,
        type: q.type,
        text: q.text,
        respondentCount,
        noResponseCount,
        totalSelections,
        hasTie: topLabels.length > 1,
        topOptionLabels: topLabels,
        options,
        textResponses,
      };
    });

  return {
    assessmentId: input.assessmentId,
    title: input.title,
    privacyMode: input.privacyMode,
    totalUniqueRespondents,
    questions: questionAggs,
  };
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildPollCsvExport(analytics: PollAnalyticsDTO): string {
  const lines: string[] = [];
  lines.push(
    [
      'Question #',
      'Question',
      'Type',
      'Option / Response',
      'Votes',
      'Respondent %',
      'Selection Share %',
      'Total Respondents',
      'No Response Count',
      'Participant',
      'Privacy Mode',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  for (const q of analytics.questions) {
    if (q.type === 'mcq' || q.type === 'multi_select') {
      for (const opt of q.options) {
        lines.push(
          [
            q.position + 1,
            q.text,
            q.type,
            opt.label,
            opt.votes,
            `${opt.respondentPercentage}%`,
            `${opt.selectionSharePercentage}%`,
            q.respondentCount,
            q.noResponseCount,
            'Aggregate',
            analytics.privacyMode,
          ]
            .map(escapeCsvCell)
            .join(',')
        );
      }
    } else {
      if (q.textResponses.length === 0) {
        lines.push(
          [
            q.position + 1,
            q.text,
            q.type,
            '(No responses)',
            0,
            '0%',
            '0%',
            0,
            q.noResponseCount,
            '-',
            analytics.privacyMode,
          ]
            .map(escapeCsvCell)
            .join(',')
        );
      } else {
        for (const tr of q.textResponses) {
          lines.push(
            [
              q.position + 1,
              q.text,
              q.type,
              tr.text,
              1,
              '-',
              '-',
              q.respondentCount,
              q.noResponseCount,
              tr.participantLabel,
              analytics.privacyMode,
            ]
              .map(escapeCsvCell)
              .join(',')
          );
        }
      }
    }
  }

  return lines.join('\r\n');
}

export function parseOfficialQrPayload(raw: string): { sessionId: string; token: string } | null {
  const trimmed = raw.trim();
  // Format 1: thinkpulse://join?sid=<uuid>&t=<token>
  // Format 2: https://.../join?sid=<uuid>&t=<token>
  // Format 3: JSON {"sid":"...","t":"..."}
  try {
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed) as { sid?: string; t?: string };
      if (parsed.sid && parsed.t) return { sessionId: parsed.sid, token: parsed.t };
      return null;
    }
    const url = new URL(trimmed);
    const sid = url.searchParams.get('sid');
    const t = url.searchParams.get('t');
    if (sid && t) return { sessionId: sid, token: t };
    return null;
  } catch {
    return null;
  }
}

export function buildOfficialQrPayload(sessionId: string, qrTokenRaw: string): string {
  return `thinkpulse://join?sid=${encodeURIComponent(sessionId)}&t=${encodeURIComponent(qrTokenRaw)}`;
}
