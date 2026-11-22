import { pool } from './index.ts';

let schemaBootstrapPromise: Promise<void> | null = null;

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "institutions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "code" text NOT NULL UNIQUE,
    "status" text DEFAULT 'active' NOT NULL,
    "settings" jsonb DEFAULT '{"allowStudentSelfRegistration": true, "defaultPrivacyMode": "normal", "graceWindowSeconds": 15}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS "profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "auth_uid" text NOT NULL UNIQUE,
    "email" text NOT NULL UNIQUE,
    "password_hash" text,
    "reset_token_hash" text,
    "reset_token_expires_at" timestamp with time zone,
    "display_name" text NOT NULL,
    "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE RESTRICT,
    "role" text DEFAULT 'student' NOT NULL,
    "server_admin" boolean DEFAULT false NOT NULL,
    "student_code" text,
    "class_section" text,
    "department" text,
    "notes" text,
    "status" text DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_profiles_institution" ON "profiles" ("institution_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_profiles_role" ON "profiles" ("role");`,
  `CREATE INDEX IF NOT EXISTS "idx_profiles_email" ON "profiles" ("email");`,

  `CREATE TABLE IF NOT EXISTS "institution_memberships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
    "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
    "membership_role" text NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_inst_membership_user_inst" ON "institution_memberships" ("user_id", "institution_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_inst_membership_inst" ON "institution_memberships" ("institution_id");`,

  `CREATE TABLE IF NOT EXISTS "classes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "section" text,
    "academic_term" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_classes_institution" ON "classes" ("institution_id");`,

  `CREATE TABLE IF NOT EXISTS "class_memberships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "student_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
    "class_id" uuid NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
    "status" text DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_class_membership" ON "class_memberships" ("student_id", "class_id");`,

  `CREATE TABLE IF NOT EXISTS "assessments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "host_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
    "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "title" text NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "instructions" text DEFAULT '' NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "privacy_mode" text DEFAULT 'normal' NOT NULL,
    "duration_minutes" integer DEFAULT 15 NOT NULL,
    "settings" jsonb DEFAULT '{"allowAlias": true, "showMarksToStudents": true, "partialCreditDefault": "none"}'::jsonb NOT NULL,
    "active_session_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_assessments_host" ON "assessments" ("host_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_assessments_inst" ON "assessments" ("institution_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_assessments_type_status" ON "assessments" ("type", "status");`,

  `CREATE TABLE IF NOT EXISTS "questions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "assessment_id" uuid NOT NULL REFERENCES "assessments"("id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "type" text NOT NULL,
    "text" text NOT NULL,
    "points" real DEFAULT 0 NOT NULL,
    "rubric" text,
    "settings" jsonb DEFAULT '{"partialCredit": false, "required": true}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_questions_assessment" ON "questions" ("assessment_id", "position");`,

  `CREATE TABLE IF NOT EXISTS "question_options" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "label" text NOT NULL,
    "is_correct" boolean DEFAULT false NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_qoptions_question" ON "question_options" ("question_id", "position");`,

  `CREATE TABLE IF NOT EXISTS "sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "assessment_id" uuid NOT NULL REFERENCES "assessments"("id") ON DELETE CASCADE,
    "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
    "host_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
    "join_code" text NOT NULL,
    "qr_token_hash" text NOT NULL,
    "qr_token_raw" text NOT NULL,
    "qr_version" integer DEFAULT 1 NOT NULL,
    "privacy_mode" text NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "duration_minutes" integer DEFAULT 15 NOT NULL,
    "launched_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_sessions_join_code" ON "sessions" ("join_code");`,
  `CREATE INDEX IF NOT EXISTS "idx_sessions_assessment" ON "sessions" ("assessment_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_sessions_inst_status" ON "sessions" ("institution_id", "status");`,

  `CREATE TABLE IF NOT EXISTS "submissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "assessment_id" uuid NOT NULL REFERENCES "assessments"("id") ON DELETE CASCADE,
    "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
    "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
    "privacy_mode" text NOT NULL,
    "student_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "anon_id" text,
    "alias" text,
    "session_token_hash" text NOT NULL,
    "status" text DEFAULT 'submitted' NOT NULL,
    "total_score" real DEFAULT 0 NOT NULL,
    "max_score" real DEFAULT 0 NOT NULL,
    "auto_submitted" boolean DEFAULT false NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_submission_session_token" ON "submissions" ("session_id", "session_token_hash");`,
  `CREATE INDEX IF NOT EXISTS "idx_submissions_assessment" ON "submissions" ("assessment_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_submissions_session" ON "submissions" ("session_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_submissions_student" ON "submissions" ("student_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_submissions_inst" ON "submissions" ("institution_id");`,

  `CREATE TABLE IF NOT EXISTS "answers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "submission_id" uuid NOT NULL REFERENCES "submissions"("id") ON DELETE CASCADE,
    "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
    "selected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "text_answer" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_answer_sub_q" ON "answers" ("submission_id", "question_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_answers_submission" ON "answers" ("submission_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_answers_question" ON "answers" ("question_id");`,

  `CREATE TABLE IF NOT EXISTS "grading_records" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "submission_id" uuid NOT NULL REFERENCES "submissions"("id") ON DELETE CASCADE,
    "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
    "awarded_points" real DEFAULT 0 NOT NULL,
    "max_points" real DEFAULT 0 NOT NULL,
    "outcome" text DEFAULT 'pending' NOT NULL,
    "feedback" text,
    "grader_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "manually_graded" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_grading_sub_q" ON "grading_records" ("submission_id", "question_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_grading_submission" ON "grading_records" ("submission_id");`,

  `CREATE TABLE IF NOT EXISTS "student_private_session_claims" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "student_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
    "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
    "submission_id" uuid NOT NULL REFERENCES "submissions"("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_private_claim_student_session" ON "student_private_session_claims" ("student_id", "session_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_private_claims_student" ON "student_private_session_claims" ("student_id");`,

  `CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "actor_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "actor_email" text,
    "institution_id" uuid REFERENCES "institutions"("id") ON DELETE SET NULL,
    "action" text NOT NULL,
    "target_type" text NOT NULL,
    "target_id" text,
    "changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_audit_inst_created" ON "audit_logs" ("institution_id", "created_at");`,
  `CREATE INDEX IF NOT EXISTS "idx_audit_action" ON "audit_logs" ("action");`,

  `CREATE TABLE IF NOT EXISTS "server_registry" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "institution_id" uuid REFERENCES "institutions"("id") ON DELETE CASCADE,
    "display_name" text NOT NULL,
    "host" text NOT NULL,
    "port" integer DEFAULT 443 NOT NULL,
    "protocol" text DEFAULT 'https' NOT NULL,
    "api_base_url" text NOT NULL,
    "environment" text DEFAULT 'production' NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "health_status" text DEFAULT 'unknown' NOT NULL,
    "latency_ms" integer,
    "last_checked_at" timestamp with time zone,
    "previous_config" jsonb,
    "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "updated_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_server_registry_inst" ON "server_registry" ("institution_id");`,

  `CREATE TABLE IF NOT EXISTS "notifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipient_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "title" text NOT NULL,
    "message" text NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_notifications_recipient" ON "notifications" ("recipient_id", "created_at");`,
];

/**
 * Ensures all 16 ThinkPulse PostgreSQL tables and indexes exist in the active
 * database (no-op when already provisioned, automatically initializes fresh
 * external Supabase PostgreSQL instances on first connection).
 */
export function ensureDatabaseSchema(): Promise<void> {
  if (!schemaBootstrapPromise) {
    schemaBootstrapPromise = (async () => {
      const check = await pool.query<{ exists: boolean }>(
        `SELECT (
          to_regclass('public.institutions') IS NOT NULL
          AND to_regclass('public.notifications') IS NOT NULL
        ) AS exists;`
      );
      if (check.rows[0]?.exists) {
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const stmt of SCHEMA_STATEMENTS) {
          await client.query(stmt);
        }
        await client.query('COMMIT');
        console.log('[db] Initialized ThinkPulse PostgreSQL schema (16 tables).');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        schemaBootstrapPromise = null;
        throw err;
      } finally {
        client.release();
      }
    })();
  }
  return schemaBootstrapPromise;
}
