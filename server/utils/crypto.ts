import crypto from 'crypto';

// Server-side ephemeral fallback if env secret is unset in local dev
const FALLBACK_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const FALLBACK_QR_PEPPER = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SIGNING_SECRET?.trim() || FALLBACK_SESSION_SECRET;
}

function getQrPepper(): string {
  return process.env.QR_TOKEN_PEPPER?.trim() || FALLBACK_QR_PEPPER;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface SignedTokenPayload {
  sub: string; // profile.id
  email: string;
  role: string;
  inst: string;
  exp: number;
  jti: string;
}

export function signAuthToken(payload: Omit<SignedTokenPayload, 'exp' | 'jti'>, ttlSeconds = 60 * 60 * 12): string {
  const fullPayload: SignedTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `tp1.${encoded}.${sig}`;
}

export function verifyAuthToken(token: string): SignedTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'tp1') return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedTokenPayload;
    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateQrToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashQrToken(rawToken: string): string {
  return crypto.createHmac('sha256', getQrPepper()).update(rawToken).digest('hex');
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(rawToken).digest('hex');
}

export function generateSixDigitCode(): string {
  // Cryptographically strong 6-digit numeric code: 100000 - 999999
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

// Random non-derivable anonymous participant ID (never derived from email or user ID)
export function generateAnonymousId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `ANON-${suffix}`;
}

export interface SessionAttemptTokenPayload {
  sid: string; // sessionId
  mode: 'anonymous' | 'normal';
  anonId?: string;
  studentId?: string;
  startedAt: string;
  nonce: string;
  exp: number;
}

export function signSessionAttemptToken(payload: Omit<SessionAttemptTokenPayload, 'nonce' | 'exp'>, ttlSeconds = 60 * 60 * 10): string {
  const full: SessionAttemptTokenPayload = {
    ...payload,
    nonce: crypto.randomBytes(12).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`attempt:${encoded}`)
    .digest('base64url');
  return `tpa1.${encoded}.${sig}`;
}

export function verifySessionAttemptToken(token: string): SessionAttemptTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'tpa1') return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`attempt:${encoded}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionAttemptTokenPayload;
    if (!parsed.sid || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateOpaqueToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'idToken',
  'sessionToken',
  'qrToken',
  'qrTokenRaw',
  'qrTokenHash',
  'authorization',
  'secret',
  'apiKey',
  'resetToken',
]);

export function sanitizeAuditMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_KEYS.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeAuditMetadata(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
