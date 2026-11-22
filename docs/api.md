# ThinkPulse API Reference

All API endpoints are versioned under `/api/v1` and return JSON. Authenticated endpoints require `Authorization: Bearer <token>`.

## Health & Realtime

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health/live` | Public | Liveness check (`{ status: "ok" }`). |
| `GET` | `/api/v1/health/ready` | Public | Readiness check executing a live PostgreSQL query. |
| `POST` | `/api/v1/realtime/ticket` | Authenticated | Issues a short-lived SSE connection ticket bound to user identity and role. |
| `GET` | `/api/v1/realtime/stream?ticket=...` | Authenticated Ticket | Opens an SSE stream scoped to the user's institution and role. |

## Authentication (`/api/v1/auth`)

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/bootstrap-status` | Public | Reports whether initial admin bootstrap is available and whether student self-registration is enabled. |
| `POST` | `/api/v1/auth/bootstrap-admin` | Public (One-Time) | Creates the initial institution and `platform_admin` account; permanently locked once an admin exists. |
| `POST` | `/api/v1/auth/login` | Public | Email/password login with role-aware `loginMode` (`host` or `student`) verified against DB role. |
| `POST` | `/api/v1/auth/google` | Public | Exchanges a verified Google/Firebase ID token for a ThinkPulse session profile and enforces `loginMode`. |
| `POST` | `/api/v1/auth/register-student` | Public (Config-Gated) | Registers a new account strictly with `role = 'student'` when allowed by institution settings. |
| `POST` | `/api/v1/auth/forgot-password` | Public | Initiates password reset flow without revealing whether an email exists. |
| `POST` | `/api/v1/auth/reset-password` | Public | Completes password reset with a valid single-use token. |
| `GET` | `/api/v1/auth/me` | Authenticated | Returns the caller's verified profile, role, and institution context. |
| `POST` | `/api/v1/auth/logout` | Authenticated | Ends the current session and records an audit event. |

## Student Portal (`/api/v1/student`)

All routes require an authenticated `student` role unless noted.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/v1/student/sessions/join-code` | Joins an active session via 6-digit numeric code; returns sanitized questions (never answer keys or rubrics). |
| `POST` | `/api/v1/student/sessions/join-qr` | Verifies an official signed QR payload server-side and joins the active session. |
| `GET` | `/api/v1/student/sessions/:sessionId/take` | Retrieves session questions, authoritative remaining server time, and existing submission state. |
| `POST` | `/api/v1/student/sessions/:sessionId/submit` | Submits answers, enforces expiry + 15-second grace window, auto-grades objective items, and emits live events. |
| `GET` | `/api/v1/student/submissions` | Lists the student's own past submissions (including their own Anonymous-mode claims). |
| `GET` | `/api/v1/student/submissions/:submissionId` | Returns detailed results, scores, and host feedback for a submission owned by the student. |

## Host Command Centre (`/api/v1/host`)

Requires `host`, `institution_admin`, or `platform_admin` role, scoped strictly to `institution_id`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/host/overview` | Returns live KPI counts, active sessions, and recent grading/submission activity. |
| `GET` | `/api/v1/host/assessments` | Lists institution assessments with optional `type` (`quiz` / `poll`) and `status` filters. |
| `POST` | `/api/v1/host/assessments` | Creates a Quiz or Poll with strict Zod validation (marks, options, question types). |
| `GET` | `/api/v1/host/assessments/:id` | Fetches full assessment details including questions, options, answer keys, and rubrics. |
| `PUT` | `/api/v1/host/assessments/:id` | Updates assessment metadata and questions. |
| `POST` | `/api/v1/host/assessments/:id/duplicate` | Clones an assessment and its questions into a new draft. |
| `DELETE` | `/api/v1/host/assessments/:id` | Deletes an assessment (or archives if sessions exist). |
| `POST` | `/api/v1/host/assessments/:id/recalculate` | Re-runs objective grading across existing quiz submissions after answer-key updates, preserving manual overrides. |
| `GET` | `/api/v1/host/sessions` | Lists active and historical sessions with submission counts and active codes. |
| `POST` | `/api/v1/host/sessions` | Launches a new live session (`normal` or `anonymous`) with a unique 6-digit code and rotating QR token. |
| `GET` | `/api/v1/host/sessions/:id/launch` | Returns current 6-digit code, QR payload data URL, expiry timestamp, and live participation count. |
| `POST` | `/api/v1/host/sessions/:id/rotate-code` | Rotates the 6-digit join code and QR token immediately. |
| `POST` | `/api/v1/host/sessions/:id/extend` | Extends an active session's expiration timestamp. |
| `POST` | `/api/v1/host/sessions/:id/end` | Terminates a live session and notifies connected clients. |
| `GET` | `/api/v1/host/sessions/:id/submissions` | Lists submissions for review and manual grading (Anonymous mode exposes only `anon_id`). |
| `POST` | `/api/v1/host/submissions/:id/grade` | Saves per-question subjective scores, total score, and qualitative feedback; emits `submission.graded`. |
| `GET` | `/api/v1/host/analytics/quiz` | Computes Quiz KPIs, score distribution, item difficulty/discrimination, and session trends. |
| `GET` | `/api/v1/host/analytics/poll` | Computes Poll Respondent % and Selection Share % distributions and open-text responses. |
| `GET` | `/api/v1/host/analytics/export` | Exports Quiz or Poll analytics as formula-safe RFC 4180 CSV. |
| `GET` | `/api/v1/host/students` | Lists institution students with Normal-mode participation summaries. |
| `GET` | `/api/v1/host/data-retrieval` | Looks up a student by email and returns strictly Normal-mode submissions. |
| `PATCH` | `/api/v1/host/students/:id` | Updates allowlisted student metadata (`fullName`, `department`, `status`) with audit logging. |
| `GET` | `/api/v1/host/audit-logs` | Returns paginated, filterable institution audit log entries. |
| `GET` | `/api/v1/host/settings` | Fetches institution configuration (`allowStudentRegistration`, default privacy/session settings). |
| `PUT` | `/api/v1/host/settings` | Updates institution settings (`institution_admin` / `platform_admin`). |

## Privileged Server Management (`/api/v1/admin/servers`)

Requires `platform_admin` or `institution_admin`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/admin/servers` | Lists registered server targets and their last health probe metadata. |
| `POST` | `/api/v1/admin/servers` | Registers a new server target after URL validation and private-network protection checks. |
| `POST` | `/api/v1/admin/servers/:id/probe` | Performs a live server-side HTTP health probe against the target's health endpoint (no redirects, strict timeout). |
| `POST` | `/api/v1/admin/servers/:id/activate` | Activates a validated healthy server target and writes an audit record. |
| `POST` | `/api/v1/admin/servers/rollback` | Rolls back active server configuration to the previously active target with audit logging. |
| `DELETE` | `/api/v1/admin/servers/:id` | Removes an inactive server target. |
