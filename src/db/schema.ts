import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. Institutions
export const institutions = pgTable('institutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  status: text('status').notNull().default('active'), // active | suspended
  settings: jsonb('settings').$type<{
    allowStudentSelfRegistration?: boolean;
    defaultPrivacyMode?: 'anonymous' | 'normal';
    graceWindowSeconds?: number;
  }>().notNull().default(sql`'{"allowStudentSelfRegistration": true, "defaultPrivacyMode": "normal", "graceWindowSeconds": 15}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Profiles (Users linked to Firebase Auth UID or server-managed Email/Password auth)
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    authUid: text('auth_uid').notNull().unique(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    resetTokenHash: text('reset_token_hash'),
    resetTokenExpiresAt: timestamp('reset_token_expires_at', { withTimezone: true }),
    displayName: text('display_name').notNull(),
    institutionId: uuid('institution_id')
      .references(() => institutions.id, { onDelete: 'restrict' })
      .notNull(),
    role: text('role').notNull().default('student'), // student | host | platform_admin
    serverAdmin: boolean('server_admin').notNull().default(false),
    studentCode: text('student_code'),
    classSection: text('class_section'),
    department: text('department'),
    notes: text('notes'),
    status: text('status').notNull().default('active'), // active | suspended | invited
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_profiles_institution').on(table.institutionId),
    index('idx_profiles_role').on(table.role),
    index('idx_profiles_email').on(table.email),
  ]
);

// 3. Institution Memberships
export const institutionMemberships = pgTable(
  'institution_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    institutionId: uuid('institution_id')
      .references(() => institutions.id, { onDelete: 'cascade' })
      .notNull(),
    membershipRole: text('membership_role').notNull(), // student | host | platform_admin
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_inst_membership_user_inst').on(table.userId, table.institutionId),
    index('idx_inst_membership_inst').on(table.institutionId),
  ]
);

// 4. Classes / Groups
export const classes = pgTable(
  'classes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .references(() => institutions.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    section: text('section'),
    academicTerm: text('academic_term'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_classes_institution').on(table.institutionId)]
);

// 5. Class Memberships
export const classMemberships = pgTable(
  'class_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    classId: uuid('class_id')
      .references(() => classes.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_class_membership').on(table.studentId, table.classId)]
);

// 6. Assessments (Quizzes and Polls)
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hostId: uuid('host_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    institutionId: uuid('institution_id')
      .references(() => institutions.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(), // quiz | poll
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    status: text('status').notNull().default('draft'), // draft | active | expired
    privacyMode: text('privacy_mode').notNull().default('normal'), // anonymous | normal
    durationMinutes: integer('duration_minutes').notNull().default(15),
    settings: jsonb('settings').$type<{
      allowAlias?: boolean;
      showMarksToStudents?: boolean;
      partialCreditDefault?: 'none' | 'proportional';
    }>().notNull().default(sql`'{"allowAlias": true, "showMarksToStudents": true, "partialCreditDefault": "none"}'::jsonb`),
    activeSessionId: uuid('active_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_assessments_host').on(table.hostId),
    index('idx_assessments_inst').on(table.institutionId),
    index('idx_assessments_type_status').on(table.type, table.status),
  ]
);

// 7. Questions
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .references(() => assessments.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').notNull(),
    type: text('type').notNull(), // mcq | multi_select | short_answer | paragraph
    text: text('text').notNull(),
    points: real('points').notNull().default(0), // Always 0 for polls; >= 0 for quizzes
    rubric: text('rubric'),
    settings: jsonb('settings').$type<{
      partialCredit?: boolean;
      required?: boolean;
    }>().notNull().default(sql`'{"partialCredit": false, "required": true}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_questions_assessment').on(table.assessmentId, table.position)]
);

// 8. Question Options
export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    questionId: uuid('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false), // Restricted to host/server; always false for polls
  },
  (table) => [index('idx_qoptions_question').on(table.questionId, table.position)]
);

// 9. Sessions (Live launched instances of an assessment)
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .references(() => assessments.id, { onDelete: 'cascade' })
      .notNull(),
    institutionId: uuid('institution_id')
      .references(() => institutions.id, { onDelete: 'cascade' })
      .notNull(),
    hostId: uuid('host_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    joinCode: text('join_code').notNull(), // Exactly 6 numeric digits
    qrTokenHash: text('qr_token_hash').notNull(),
    qrTokenRaw: text('qr_token_raw').notNull(), // Exposed strictly to owning host for QR display/download
    qrVersion: integer('qr_version').notNull().default(1),
    privacyMode: text('privacy_mode').notNull(), // Snapshot: anonymous | normal
    status: text('status').notNull().default('active'), // active | expired | ended
    durationMinutes: integer('duration_minutes').notNull().default(15),
    launchedAt: timestamp('launched_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sessions_join_code').on(table.joinCode),
    index('idx_sessions_assessment').on(table.assessmentId),
    index('idx_sessions_inst_status').on(table.institutionId, table.status),
  ]
);

// 10. Submissions
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .references(() => assessments.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    institutionId: uuid('institution_id')
      .references(() => institutions.id, { onDelete: 'cascade' })
      .notNull(),
    privacyMode: text('privacy_mode').notNull(), // anonymous | normal
    // STRICT PRIVACY INVARIANT: studentId MUST be NULL when privacyMode === 'anonymous'
    studentId: uuid('student_id').references(() => profiles.id, { onDelete: 'set null' }),
    anonId: text('anon_id'), // Random non-derivable ID when privacyMode === 'anonymous'
    alias: text('alias'),
    sessionTokenHash: text('session_token_hash').notNull(),
    status: text('status').notNull().default('submitted'), // submitted | pending_review | reviewed
    totalScore: real('total_score').notNull().default(0),
    maxScore: real('max_score').notNull().default(0),
    autoSubmitted: boolean('auto_submitted').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_submission_session_token').on(table.sessionId, table.sessionTokenHash),
    index('idx_submissions_assessment').on(table.assessmentId),
    index('idx_submissions_session').on(table.sessionId),
    index('idx_submissions_student').on(table.studentId),
    index('idx_submissions_inst').on(table.institutionId),
  ]
);

// 11. Answers (Immutable after creation)
export const answers = pgTable(
  'answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .references(() => submissions.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: uuid('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    selectedOptionIds: jsonb('selected_option_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    textAnswer: text('text_answer'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_answer_sub_q').on(table.submissionId, table.questionId),
    index('idx_answers_submission').on(table.submissionId),
    index('idx_answers_question').on(table.questionId),
  ]
);

// 12. Grading Records (Only for Quiz assessments)
export const gradingRecords = pgTable(
  'grading_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .references(() => submissions.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: uuid('question_id')
      .references(() => questions.id, { onDelete: 'cascade' })
      .notNull(),
    awardedPoints: real('awarded_points').notNull().default(0),
    maxPoints: real('max_points').notNull().default(0),
    outcome: text('outcome').notNull().default('pending'), // correct | partial | incorrect | pending
    feedback: text('feedback'),
    graderId: uuid('grader_id').references(() => profiles.id, { onDelete: 'set null' }),
    manuallyGraded: boolean('manually_graded').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_grading_sub_q').on(table.submissionId, table.questionId),
    index('idx_grading_submission').on(table.submissionId),
  ]
);

// 13. Restricted Student Private Session Claims
// Server-only restricted mapping allowing a student to retrieve THEIR OWN Anonymous-mode results.
// NEVER queried or exposed in any Host API, Data Retrieval endpoint, or CSV export!
export const studentPrivateSessionClaims = pgTable(
  'student_private_session_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    submissionId: uuid('submission_id')
      .references(() => submissions.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_private_claim_student_session').on(table.studentId, table.sessionId),
    index('idx_private_claims_student').on(table.studentId),
  ]
);

// 14. Audit Logs (Immutable append-only history)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    changedFields: jsonb('changed_fields').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_inst_created').on(table.institutionId, table.createdAt),
    index('idx_audit_action').on(table.action),
  ]
);

// 15. Server Registry (Platform Admin / serverAdmin only)
export const serverRegistry = pgTable(
  'server_registry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(443),
    protocol: text('protocol').notNull().default('https'), // https | http
    apiBaseUrl: text('api_base_url').notNull(),
    environment: text('environment').notNull().default('production'), // development | staging | production
    isActive: boolean('is_active').notNull().default(false),
    isEnabled: boolean('is_enabled').notNull().default(true),
    healthStatus: text('health_status').notNull().default('unknown'), // unknown | healthy | degraded | unreachable
    latencyMs: integer('latency_ms'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    previousConfig: jsonb('previous_config').$type<{
      displayName: string;
      host: string;
      port: number;
      protocol: string;
      apiBaseUrl: string;
      environment: string;
      savedAt: string;
    } | null>(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_server_registry_inst').on(table.institutionId)]
);

// 16. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientId: uuid('recipient_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_notifications_recipient').on(table.recipientId, table.createdAt)]
);

// Relations
export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  host: one(profiles, { fields: [assessments.hostId], references: [profiles.id] }),
  institution: one(institutions, { fields: [assessments.institutionId], references: [institutions.id] }),
  questions: many(questions),
  sessions: many(sessions),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  assessment: one(assessments, { fields: [questions.assessmentId], references: [assessments.id] }),
  options: many(questionOptions),
}));

export const questionOptionsRelations = relations(questionOptions, ({ one }) => ({
  question: one(questions, { fields: [questionOptions.questionId], references: [questions.id] }),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  assessment: one(assessments, { fields: [submissions.assessmentId], references: [assessments.id] }),
  session: one(sessions, { fields: [submissions.sessionId], references: [sessions.id] }),
  student: one(profiles, { fields: [submissions.studentId], references: [profiles.id] }),
  answers: many(answers),
  gradingRecords: many(gradingRecords),
}));
