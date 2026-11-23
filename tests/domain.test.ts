import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePollResults,
  buildOfficialQrPayload,
  buildPollCsvExport,
  canAcceptSubmission,
  computeSubmissionTotals,
  gradeObjectiveQuestion,
  normalizeSixDigitCode,
  parseOfficialQrPayload,
} from '../server/services/domain.ts';
import { isPrivateOrDisallowedIp, validateServerTarget } from '../server/utils/ssrf.ts';
import { generateAnonymousId, generateSixDigitCode, hashPassword, verifyPassword } from '../server/utils/crypto.ts';

test('6-digit numeric code normalization and generation', () => {
  assert.equal(normalizeSixDigitCode('482 910'), '482910');
  assert.equal(normalizeSixDigitCode('482-910'), '482910');
  assert.equal(normalizeSixDigitCode('AB1234'), null);
  assert.equal(normalizeSixDigitCode('12345'), null);
  assert.equal(normalizeSixDigitCode('1234567'), null);

  for (let i = 0; i < 20; i++) {
    const code = generateSixDigitCode();
    assert.match(code, /^\d{6}$/);
  }
});

test('authoritative session expiry and bounded 15s auto-submit grace window', () => {
  const expiresAt = new Date('2026-11-21T10:15:00.000Z');
  const startedBefore = new Date('2026-11-21T10:05:00.000Z');
  const startedAfter = new Date('2026-11-21T10:15:01.000Z');

  // Within active window
  assert.equal(
    canAcceptSubmission({
      sessionStatus: 'active',
      expiresAt,
      startedAt: startedBefore,
      autoSubmitted: false,
      now: new Date('2026-11-21T10:14:59.000Z'),
    }).allowed,
    true
  );

  // Ordinary manual submit after expiry rejected
  assert.equal(
    canAcceptSubmission({
      sessionStatus: 'active',
      expiresAt,
      startedAt: startedBefore,
      autoSubmitted: false,
      now: new Date('2026-11-21T10:15:05.000Z'),
    }).allowed,
    false
  );

  // Timer-triggered auto-submit within 15s grace window allowed when started before expiry
  assert.equal(
    canAcceptSubmission({
      sessionStatus: 'active',
      expiresAt,
      startedAt: startedBefore,
      autoSubmitted: true,
      now: new Date('2026-11-21T10:15:10.000Z'),
    }).allowed,
    true
  );

  // Auto-submit beyond 15s grace window rejected
  assert.equal(
    canAcceptSubmission({
      sessionStatus: 'active',
      expiresAt,
      startedAt: startedBefore,
      autoSubmitted: true,
      now: new Date('2026-11-21T10:15:16.000Z'),
    }).allowed,
    false
  );

  // Client claiming autoSubmitted cannot bypass if started after expiry or session was ended
  assert.equal(
    canAcceptSubmission({
      sessionStatus: 'active',
      expiresAt,
      startedAt: startedAfter,
      autoSubmitted: true,
      now: new Date('2026-11-21T10:15:05.000Z'),
    }).allowed,
    false
  );
  assert.equal(
    canAcceptSubmission({
      sessionStatus: 'ended',
      expiresAt,
      startedAt: startedBefore,
      autoSubmitted: true,
      now: new Date('2026-11-21T10:10:00.000Z'),
    }).allowed,
    false
  );
});

test('objective grading: MCQ exact, Multi-Select exact & partial credit, written pending review', () => {
  const mcq = gradeObjectiveQuestion(
    { id: 'q1', type: 'mcq', points: 4, partialCredit: false, correctOptionIds: ['o1'] },
    ['o1']
  );
  assert.equal(mcq.awardedPoints, 4);
  assert.equal(mcq.outcome, 'correct');

  const multiPartial = gradeObjectiveQuestion(
    { id: 'q2', type: 'multi_select', points: 4, partialCredit: true, correctOptionIds: ['a', 'b'] },
    ['a']
  );
  assert.equal(multiPartial.awardedPoints, 2);
  assert.equal(multiPartial.outcome, 'partial');

  const multiExactNoPartial = gradeObjectiveQuestion(
    { id: 'q2', type: 'multi_select', points: 4, partialCredit: false, correctOptionIds: ['a', 'b'] },
    ['a']
  );
  assert.equal(multiExactNoPartial.awardedPoints, 0);
  assert.equal(multiExactNoPartial.outcome, 'incorrect');

  const written = gradeObjectiveQuestion(
    { id: 'q3', type: 'paragraph', points: 10, partialCredit: false, correctOptionIds: [] },
    []
  );
  assert.equal(written.outcome, 'pending');
  assert.equal(written.requiresManualReview, true);

  const totals = computeSubmissionTotals([mcq, multiPartial, written]);
  assert.equal(totals.totalScore, 6);
  assert.equal(totals.maxScore, 18);
  assert.equal(totals.status, 'pending_review');
});

test('poll aggregation separates respondent percentage and selection-share percentage, detects ties, and respects anonymous CSV', () => {
  const analytics = aggregatePollResults({
    assessmentId: 'p1',
    title: 'Lecture Check-in',
    privacyMode: 'anonymous',
    questions: [
      {
        id: 'q1',
        position: 0,
        type: 'multi_select',
        text: 'Which topics need review?',
        options: [
          { id: 'o1', position: 0, label: 'SQL Joins' },
          { id: 'o2', position: 1, label: 'Indexes' },
          { id: 'o3', position: 2, label: 'Transactions' },
        ],
      },
      {
        id: 'q2',
        position: 1,
        type: 'short_answer',
        text: 'Any questions?',
        options: [],
      },
    ],
    submissions: [
      {
        id: 's1',
        participantLabel: 'ANON-K82P9X',
        submittedAt: '2026-11-21T10:00:00.000Z',
        answers: [
          { questionId: 'q1', selectedOptionIds: ['o1', 'o2'], textAnswer: null },
          { questionId: 'q2', selectedOptionIds: [], textAnswer: 'Explain B-Tree indexes.' },
        ],
      },
      {
        id: 's2',
        participantLabel: 'ANON-M49T2L',
        submittedAt: '2026-11-21T10:01:00.000Z',
        answers: [
          { questionId: 'q1', selectedOptionIds: ['o1', 'o2'], textAnswer: null },
          { questionId: 'q2', selectedOptionIds: [], textAnswer: null },
        ],
      },
    ],
  });

  assert.equal(analytics.totalUniqueRespondents, 2);
  const q1 = analytics.questions[0];
  assert.equal(q1.respondentCount, 2);
  assert.equal(q1.totalSelections, 4);
  assert.equal(q1.hasTie, true);
  // Both o1 and o2 chosen by 100% of respondents, each represents 50% of total selections
  assert.equal(q1.options[0].respondentPercentage, 100);
  assert.equal(q1.options[0].selectionSharePercentage, 50);

  const q2 = analytics.questions[1];
  assert.equal(q2.respondentCount, 1);
  assert.equal(q2.noResponseCount, 1);

  const csv = buildPollCsvExport(analytics);
  assert.ok(csv.includes('ANON-K82P9X'));
  assert.ok(csv.includes('Respondent %'));
  assert.ok(csv.includes('Selection Share %'));
  assert.ok(!csv.includes('@')); // Zero email identity in anonymous CSV
});

test('QR payload roundtrip, scrypt password hashing, anonymous ID format, and SSRF target protection', async () => {
  const qr = buildOfficialQrPayload('550e8400-e29b-41d4-a716-446655440000', 'tok_secret_xyz');
  const parsed = parseOfficialQrPayload(qr);
  assert.deepEqual(parsed, {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    token: 'tok_secret_xyz',
  });

  const hash = hashPassword('ThinkPulse2026!');
  assert.equal(verifyPassword('ThinkPulse2026!', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);

  assert.match(generateAnonymousId(), /^ANON-[A-Z0-9]{6}$/);

  // SSRF checks block loopback, cloud metadata, and private RFC1918 ranges
  assert.equal(isPrivateOrDisallowedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrDisallowedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrDisallowedIp('10.0.1.5'), true);
  assert.equal(isPrivateOrDisallowedIp('192.168.1.10'), true);
  assert.equal(isPrivateOrDisallowedIp('::1'), true);

  const blockedMeta = await validateServerTarget({
    host: '169.254.169.254',
    port: 80,
    protocol: 'http',
    apiBaseUrl: 'http://169.254.169.254',
    environment: 'staging',
  });
  assert.equal(blockedMeta.valid, false);

  const blockedHttpProd = await validateServerTarget({
    host: 'api.example.com',
    port: 80,
    protocol: 'http',
    apiBaseUrl: 'http://api.example.com',
    environment: 'production',
  });
  assert.equal(blockedHttpProd.valid, false);
});

test('direct HTTPS anonymous QR URL roundtrip and guest result receipt token integrity', async () => {
  const { signGuestResultToken, verifyGuestResultToken, timingSafeEqualStrings } = await import(
    '../server/utils/crypto.ts'
  );

  const sid = '550e8400-e29b-41d4-a716-446655440000';
  const tok = 'qr_anon_token_123456';
  const webQr = buildOfficialQrPayload(sid, tok, 'https://thinkpulse.example.run.app/dashboard');
  assert.equal(webQr, `https://thinkpulse.example.run.app/join?sid=${sid}&t=${tok}`);
  assert.deepEqual(parseOfficialQrPayload(webQr), { sessionId: sid, token: tok });

  // Invalid / non-http scheme falls back safely to thinkpulse://
  const fallbackQr = buildOfficialQrPayload(sid, tok, 'javascript:alert(1)');
  assert.ok(fallbackQr.startsWith('thinkpulse://join?'));

  const receipt = signGuestResultToken({ subId: 'sub-123', sid });
  const verified = verifyGuestResultToken(receipt);
  assert.equal(verified?.subId, 'sub-123');
  assert.equal(verified?.sid, sid);
  assert.equal(verifyGuestResultToken(`${receipt}tampered`), null);
  assert.equal(timingSafeEqualStrings('abc', 'abc'), true);
  assert.equal(timingSafeEqualStrings('abc', 'abd'), false);
});
