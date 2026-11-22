# ThinkPulse

ThinkPulse is a full-stack classroom interaction, assessment, and feedback platform supporting live **Quizzes** (with automated objective grading, manual subjective review, and safe answer-key recalculation) and **Polls** (with clean Respondent % and Selection Share % analytics), backed by a persistent PostgreSQL database and real-time Server-Sent Events (SSE).

## Core Features

- **Unified Split-Screen Authentication**: Role-aware `Host Login` and `Student Login` entry with Email/Password (`scrypt` password hashing + server-issued HMAC Bearer tokens) and Google Sign-In, plus institution-configurable Student Registration, forgot/reset password flow, and one-time first-run Platform Admin bootstrap.
- **Student Portal**:
  - 6-digit numeric session code entry with paste and keyboard navigation.
  - Inbuilt live camera QR scanner (`getUserMedia` + `jsQR`) and QR image upload fallback, verified strictly server-side.
  - Quiz and Poll taker with authoritative server-synced countdown timer and 15-second network auto-submit grace window.
  - Student Result & Feedback view with live SSE score and feedback updates.
- **Host Command Centre**:
  - Real-time KPI overview backed by SQL aggregates across assessments, sessions, submissions, and grading queues.
  - Separate **Quiz Generator** and **Poll Generator** builders with typed question editors, validation, duplication, and lifecycle management (`draft` / `published` / `archived`).
  - **Session Launcher** generating unique 6-digit codes, server-signed rotating QR payloads, privacy mode selection (`Normal` or `Anonymous`), expiry extension, and immediate session termination.
  - **Review & Grading Panel** for subjective scoring, qualitative feedback, and idempotent answer-key recalculation across existing submissions.
  - **Analytics & CSV Export**: Quiz score distributions, item difficulty/discrimination metrics, Poll Respondent % vs. Selection Share % breakdowns, and RFC 4180 formula-safe CSV exports.
  - **Student Database & Normal-Mode Data Retrieval**: Institution-scoped directory and email lookup strictly isolated to `normal`-mode records, with allowlisted metadata edits and audit logging.
  - **Privileged Server Management Portal**: Live health probe with private-network protection, plus audited activation and rollback controls restricted to `platform_admin` and `institution_admin`.
  - **Audit Logs & Settings**: Filterable institutional audit trail and institution-wide defaults.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide icons, Recharts, `jsqr`
- **Backend**: Node.js, Express, TypeScript (`tsx`), Zod validation, authenticated SSE event bus
- **Database**: PostgreSQL (provisioned on Cloud SQL) with Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`)
- **Authentication**: Firebase Auth (Google Sign-In) + server-managed `scrypt` Email/Password & HMAC session tokens

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables based on `.env.example` (set strong random secrets for `SESSION_SIGNING_SECRET` and `QR_TOKEN_PEPPER` in production).
3. Start the unified full-stack server on port `3000`:
   ```bash
   npm run dev
   ```
4. Open the application in your browser:
   - On a fresh database, sign in with the configured owner Google account or use the one-time **Initialize Admin Account** option on the Host Login screen to create the first Platform Administrator.
5. Run automated domain unit tests:
   ```bash
   npm test
   ```
6. Build for production:
   ```bash
   npm run build
   npm start
   ```

## Documentation

- [Architecture & Data Model](docs/architecture.md)
- [REST API & Realtime Reference](docs/api.md)
- [Security, RBAC & Privacy Invariants](docs/security.md)
- [Deployment & Operations](docs/deployment.md)
