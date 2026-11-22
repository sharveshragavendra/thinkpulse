export type UserRole = 'student' | 'host' | 'platform_admin';
export type LoginMode = 'host' | 'student';
export type AssessmentType = 'quiz' | 'poll';
export type AssessmentStatus = 'draft' | 'active' | 'expired';
export type PrivacyMode = 'anonymous' | 'normal';
export type QuestionType = 'mcq' | 'multi_select' | 'short_answer' | 'paragraph';
export type SessionStatus = 'active' | 'expired' | 'ended';
export type SubmissionStatus = 'submitted' | 'pending_review' | 'reviewed';
export type GradingOutcome = 'correct' | 'partial' | 'incorrect' | 'pending';
export type ServerEnvironment = 'development' | 'staging' | 'production';
export type ServerHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unreachable';

export interface InstitutionInfo {
  id: string;
  name: string;
  code: string;
  status: string;
  settings: {
    allowStudentSelfRegistration?: boolean;
    defaultPrivacyMode?: PrivacyMode;
    graceWindowSeconds?: number;
  };
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  serverAdmin: boolean;
  institutionId: string;
  institutionName?: string;
  studentCode?: string | null;
  classSection?: string | null;
  department?: string | null;
  notes?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionOptionDTO {
  id?: string;
  position: number;
  label: string;
  isCorrect?: boolean; // Omitted in public/student pre-submission payloads
}

export interface QuestionDTO {
  id?: string;
  position: number;
  type: QuestionType;
  text: string;
  points: number;
  rubric?: string | null; // Omitted in public/student pre-submission payloads
  settings?: {
    partialCredit?: boolean;
    required?: boolean;
  };
  options: QuestionOptionDTO[];
}

export interface AssessmentDTO {
  id: string;
  hostId: string;
  institutionId: string;
  type: AssessmentType;
  title: string;
  description: string;
  instructions: string;
  status: AssessmentStatus;
  privacyMode: PrivacyMode;
  durationMinutes: number;
  settings: {
    allowAlias?: boolean;
    showMarksToStudents?: boolean;
    partialCreditDefault?: 'none' | 'proportional';
  };
  activeSessionId?: string | null;
  questionCount?: number;
  totalPoints?: number;
  submissionCount?: number;
  pendingReviewCount?: number;
  privacyLocked?: boolean;
  questions?: QuestionDTO[];
  activeSession?: SessionDTO | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDTO {
  id: string;
  assessmentId: string;
  assessmentTitle?: string;
  assessmentType?: AssessmentType;
  joinCode: string;
  qrTokenRaw?: string; // Host-only
  qrDataUrl?: string; // Host-only
  qrPayload?: string; // Host-only
  qrVersion: number;
  privacyMode: PrivacyMode;
  status: SessionStatus;
  effectiveStatus: SessionStatus;
  durationMinutes: number;
  launchedAt: string;
  expiresAt: string;
  endedAt?: string | null;
  remainingSeconds: number;
  submissionCount?: number;
}

export interface PublicSessionDTO {
  sessionId: string;
  assessmentId: string;
  type: AssessmentType;
  title: string;
  description: string;
  instructions: string;
  privacyMode: PrivacyMode;
  joinCode: string;
  expiresAt: string;
  serverTime: string;
  remainingSeconds: number;
  allowAlias: boolean;
  showMarksToStudents: boolean;
  alreadySubmitted: boolean;
  existingSubmissionId?: string | null;
  questions: Array<{
    id: string;
    position: number;
    type: QuestionType;
    text: string;
    points: number;
    required: boolean;
    options: Array<{ id: string; position: number; label: string }>;
  }>;
}

export interface SubmissionSummaryDTO {
  id: string;
  assessmentId: string;
  assessmentTitle?: string;
  assessmentType?: AssessmentType;
  sessionId: string;
  joinCode?: string;
  privacyMode: PrivacyMode;
  participantLabel: string; // Anon ID (+ alias) in Anonymous mode; Student Name in Normal mode
  participantEmail?: string | null; // STRICTLY NULL in Anonymous mode
  anonId?: string | null;
  alias?: string | null;
  studentId?: string | null; // STRICTLY NULL in Anonymous mode
  status: SubmissionStatus;
  totalScore: number;
  maxScore: number;
  percentage: number | null;
  autoSubmitted: boolean;
  submittedAt: string;
}

export interface SubmissionDetailDTO extends SubmissionSummaryDTO {
  startedAt: string;
  hasPendingWritten: boolean;
  items: Array<{
    questionId: string;
    position: number;
    type: QuestionType;
    text: string;
    points: number;
    rubric?: string | null;
    options: Array<{ id: string; label: string; isCorrect?: boolean }>;
    selectedOptionIds: string[];
    textAnswer: string | null;
    grading: {
      awardedPoints: number;
      maxPoints: number;
      outcome: GradingOutcome;
      feedback: string | null;
      manuallyGraded: boolean;
      updatedAt: string;
    } | null;
  }>;
}

export interface QuizAnalyticsDTO {
  assessmentId: string;
  title: string;
  privacyMode: PrivacyMode;
  attemptCount: number;
  completionCount: number;
  pendingReviewCount: number;
  reviewedCount: number;
  isProvisional: boolean;
  maxPossibleScore: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  distribution: Array<{ bucket: string; count: number }>;
  questionStats: Array<{
    questionId: string;
    position: number;
    text: string;
    type: QuestionType;
    maxPoints: number;
    averageAwarded: number;
    accuracyRate: number;
    pendingCount: number;
  }>;
}

export interface PollOptionAggregateDTO {
  optionId: string;
  label: string;
  votes: number;
  respondentPercentage: number;
  selectionSharePercentage: number;
  isTop: boolean;
}

export interface PollQuestionAggregateDTO {
  questionId: string;
  position: number;
  type: QuestionType;
  text: string;
  respondentCount: number;
  noResponseCount: number;
  totalSelections: number;
  hasTie: boolean;
  topOptionLabels: string[];
  options: PollOptionAggregateDTO[];
  textResponses: Array<{
    participantLabel: string;
    text: string;
    submittedAt: string;
  }>;
}

export interface PollAnalyticsDTO {
  assessmentId: string;
  title: string;
  privacyMode: PrivacyMode;
  totalUniqueRespondents: number;
  questions: PollQuestionAggregateDTO[];
}

export interface StudentRetrievalResultDTO {
  student: UserProfile;
  normalModeSummary: {
    totalQuizAttempts: number;
    totalPollParticipations: number;
    averageQuizPercentage: number | null;
    pendingReviews: number;
  };
  activity: Array<{
    submissionId: string;
    assessmentId: string;
    assessmentTitle: string;
    assessmentType: AssessmentType;
    sessionId: string;
    joinCode: string;
    status: SubmissionStatus;
    totalScore: number;
    maxScore: number;
    submittedAt: string;
    answers: Array<{
      questionText: string;
      questionType: QuestionType;
      answerDisplay: string;
      awardedPoints: number | null;
      maxPoints: number | null;
      outcome: string | null;
      feedback: string | null;
    }>;
  }>;
  auditHistory: AuditLogDTO[];
}

export interface ServerRecordDTO {
  id: string;
  displayName: string;
  host: string;
  port: number;
  protocol: 'https' | 'http';
  apiBaseUrl: string;
  environment: ServerEnvironment;
  isActive: boolean;
  isEnabled: boolean;
  healthStatus: ServerHealthStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  hasRollback: boolean;
  previousConfig?: {
    displayName: string;
    host: string;
    port: number;
    protocol: string;
    apiBaseUrl: string;
    environment: string;
    savedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDTO {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  changedFields: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface HostOverviewDTO {
  metrics: {
    totalStudents: number;
    totalQuizzes: number;
    totalPolls: number;
    activeSessions: number;
    totalSubmissions: number;
    pendingReviews: number;
  };
  activeSessionsList: SessionDTO[];
  recentActivity: AuditLogDTO[];
}

export type RealtimeEventType =
  | 'assessment.session_launched'
  | 'assessment.session_extended'
  | 'assessment.session_ended'
  | 'assessment.qr_rotated'
  | 'submission.created'
  | 'submission.graded'
  | 'submission.recalculated'
  | 'poll.responses_updated'
  | 'student.profile_updated';

export interface RealtimeEvent {
  eventId: string;
  type: RealtimeEventType;
  institutionId: string;
  assessmentId?: string;
  sessionId?: string;
  submissionId?: string;
  studentId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
