# ThinkPulse Security, RBAC & Privacy Design

## Role-Based Access Control (RBAC)

ThinkPulse enforces four database-backed roles:

| Role | Scope | Permissions |
| --- | --- | --- |
| `student` | Own claims & active sessions | Join sessions via code/QR, submit answers, view own Normal and Anonymous results/feedback. |
| `host` | Assigned `institution_id` | Create/manage Quizzes & Polls, launch/control sessions, review/grade submissions, view analytics, export CSV, retrieve Normal-mode student data. |
| `institution_admin` | Assigned `institution_id` | All `host` capabilities plus institution settings, audit log oversight, and server registry management. |
| `platform_admin` | Platform & institution | Full administrative control including initial bootstrap, institution settings, and server registry management. |

### Login Mode Enforcement
- The split-screen login mode toggle (`Host Login` vs. `Student Login`) is **role-aware, never role-granting**.
- On login, the server resolves the account's role from PostgreSQL (`profiles.role`) and rejects any mismatch with HTTP `403`.
- Student self-registration always assigns `role = 'student'` on the server, ignoring any client-supplied role fields.
- The one-time `/api/v1/auth/bootstrap-admin` endpoint checks whether any `platform_admin` exists and permanently disables itself once claimed.

## Data & Privacy Invariants

1. **Zero Client Trust**: The server never trusts client-supplied `role`, `institutionId`, `hostId`, `studentId`, `score`, or `privacyMode`. All ownership checks and grading calculations execute server-side.
2. **Pre-Submission Answer Protection**: Student session-join and assessment-taking endpoints strip `isCorrect`, `correctOptionIds`, and `rubric` before returning questions.
3. **Anonymous Mode Isolation**:
   - Anonymous submissions persist `student_id = NULL` with a cryptographically random `ANON-XXXXXX` identifier.
   - Student self-access to Anonymous results is mediated solely through `student_private_session_claims`, which is inaccessible to all host endpoints, analytics queries, Data Retrieval lookups, and CSV exports.
4. **In-Memory Token Handling**: Session Bearer tokens are held strictly in React memory (`src/services/api.ts`) and never persisted to `localStorage` or `sessionStorage`.
5. **Password & Token Security**:
   - Passwords are hashed using Node's `crypto.scrypt` with per-user random salts and compared with `crypto.timingSafeEqual`.
   - QR join tokens are HMAC-signed with `QR_TOKEN_PEPPER` and validated server-side against stored hashes and rotation windows.
6. **CSV Formula Injection Protection**: All exported CSV cells are sanitized (prefixing leading `=`, `+`, `-`, `@`, tab, or CR characters) and RFC 4180 escaped.

## Server Registry Network Protection

The Server Management Portal validates all target URLs before storing or probing:
- Rejects non-HTTP(S) schemes and enforces HTTPS in production.
- Blocks loopback, private RFC 1918, link-local, unique-local IPv6, and cloud metadata IP ranges both literally and after DNS resolution (`dns.lookup`).
- Disables HTTP redirect following (`redirect: 'error'`) and applies strict request timeouts during health probes.

## Audit Logging

Sensitive actions write structured records into `audit_logs` (with sensitive keys automatically stripped by `sanitizeAuditMetadata`):
- Authentication events, admin bootstrap, role mismatches
- Assessment lifecycle changes and answer-key recalculations
- Session launch, code rotation, extension, and termination
- Manual grading overrides and student metadata edits
- Server target registration, health probing, activation, and rollback
