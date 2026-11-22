# ThinkPulse Architecture

## System Overview

ThinkPulse runs as a unified TypeScript full-stack application served on port `3000`:

1. **Presentation Layer (`src/`)**: React 19 SPA compiled with Vite. Communicates exclusively with versioned `/api/v1/*` backend routes using in-memory Bearer tokens (no tokens in `localStorage`) and subscribes to scoped Server-Sent Events (`/api/v1/realtime/stream`).
2. **Application & API Layer (`server.ts`, `server/routes/*`, `server/middleware/*`)**: Express server handling authentication, role-based access control, Zod schema validation, sliding-window rate limiting, live health probes, and business workflows.
3. **Domain Layer (`server/services/domain.ts`, `server/services/audit.ts`)**: Pure, unit-tested business rules covering 6-digit code normalization, authoritative session expiry and 15-second grace windows, objective Quiz grading (MCQ and Multi-Select with optional partial credit), Poll aggregation (Respondent % vs. Selection Share %), official QR payload generation/parsing, and RFC 4180 formula-safe CSV serialization.
4. **Persistence Layer (`src/db/schema.ts`, `src/db/index.ts`)**: PostgreSQL database accessed via Drizzle ORM (`pg.Pool` configured via `SQL_*` environment variables).

## Database Schema (16 Normalized Tables)

All primary keys use UUIDs (`gen_random_uuid()`), with foreign keys and composite indexes supporting multi-tenant institution isolation:

- **Identity & Tenancy**: `institutions`, `profiles`, `institution_memberships`, `classes`, `class_memberships`
- **Assessments**: `assessments`, `questions`, `question_options`
- **Live Delivery**: `sessions`
- **Responses & Grading**: `submissions`, `answers`, `grading_records`, `student_private_session_claims`
- **Governance & Operations**: `audit_logs`, `server_registry`, `notifications`

## Privacy Isolation Architecture

ThinkPulse enforces strict separation between **Normal** and **Anonymous** session modes at the schema and query level:

- **Normal Mode (`privacy_mode = 'normal'`)**:
  - `submissions.student_id` references `profiles.id`.
  - Host grading, analytics, CSV export, and Student Data Retrieval display verified student identity.
- **Anonymous Mode (`privacy_mode = 'anonymous'`)**:
  - `submissions.student_id` is stored as `NULL`.
  - A random, non-derivable anonymous handle (`ANON-XXXXXX`) is generated per submission.
  - A separate server-only table (`student_private_session_claims`) maps `(session_id, student_id) -> submission_id` solely so the submitting student can view their own result and feedback in the Student Portal.
  - No host endpoint, review panel, analytics query, CSV export, or Student Data Retrieval lookup ever reads or joins `student_private_session_claims`.

## Real-Time Event Architecture

- Clients obtain a short-lived, single-use SSE ticket via `POST /api/v1/realtime/ticket` (authenticated with their Bearer token), then open `GET /api/v1/realtime/stream?ticket=...`.
- The in-process event bus (`server/realtime/bus.ts`) routes events strictly by `institutionId`, `audience` (`hosts`, `session`, or `student`), and optional `studentId` / `sessionId`:
  - `session.created`, `session.code_rotated`, `session.extended`, `session.ended`
  - `submission.created`, `submission.graded`, `submission.recalculated`
  - `analytics.updated`, `server.switched`
