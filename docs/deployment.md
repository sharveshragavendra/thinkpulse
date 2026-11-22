# ThinkPulse Deployment & Operations Guide

## Runtime Architecture

ThinkPulse serves both the compiled React SPA (`dist/`) and the Express `/api/v1/*` API from a single Node.js process (`server.ts`) listening on port `3000`.

- **Development**: `npm run dev` runs `tsx server.ts`, mounting Vite's middleware for frontend serving alongside `/api/v1/*` routes.
- **Production**: `npm run build` builds the frontend bundle into `dist/`, and `npm start` runs `NODE_ENV=production tsx server.ts` to serve static assets and API routes.

## Environment Variables

Configure the following environment variables in your deployment environment (see `.env.example`):

| Variable | Required | Description |
| --- | --- | --- |
| `SESSION_SIGNING_SECRET` | Yes (Prod) | High-entropy random secret (32+ bytes) used to sign server-issued session Bearer tokens and SSE tickets. |
| `QR_TOKEN_PEPPER` | Yes (Prod) | High-entropy random secret used to HMAC-sign rotating session QR tokens. |
| `APP_URL` | Recommended | Public base URL of the deployed application (used for CORS origin checks and QR payloads). |
| `OWNER_EMAIL` | Optional | Email address automatically recognized as `platform_admin` on initial Google Sign-In. |
| `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME` | Provisioned | PostgreSQL connection parameters injected by the hosted Cloud SQL runtime. |

> **Important**: Never commit real secrets to source control. Rotate `SESSION_SIGNING_SECRET` and `QR_TOKEN_PEPPER` if compromised.

## Pre-Deployment Checklist

1. **Secrets**: Confirm strong `SESSION_SIGNING_SECRET` and `QR_TOKEN_PEPPER` values are configured.
2. **Database Schema**: Ensure all 16 PostgreSQL tables defined in `src/db/schema.ts` are applied to the target instance.
3. **Verification**: Run:
   ```bash
   npm test
   npm run lint
   npm run build
   ```
4. **Health Endpoints**: Configure platform liveness and readiness probes against:
   - Liveness: `GET /api/v1/health/live`
   - Readiness: `GET /api/v1/health/ready` (verifies live PostgreSQL connectivity)
5. **Initial Admin Setup**: On first boot, either sign in with the configured owner Google account or complete the one-time **Initialize Admin Account** bootstrap from Host Login.

## Rollback & Backup Guidance

- **Database**: Use managed Cloud SQL automated daily backups and point-in-time recovery before applying destructive schema migrations.
- **Server Registry**: Use the **Rollback to Previous Server** action in the Admin Server Management Portal to revert an active backend target cleanly with full audit trail coverage.
- **Zero-Downtime Notes**: Because SSE connections are held in memory per Node instance, scaling horizontally beyond a single instance requires introducing a shared pub/sub broker (such as Redis Pub/Sub or PostgreSQL `LISTEN`/`NOTIFY`) to fan out SSE events across replicas.
