import dns from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '0.0.0.0',
  '::1',
]);

const ALLOWED_PORTS = new Set([80, 443, 3000, 4000, 5000, 8000, 8080, 8443]);

export function isPrivateOrDisallowedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  // Handle IPv4-mapped IPv6 like ::ffff:127.0.0.1
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (!net.isIPv4(v4)) {
    // Reject unknown non-public IPv6 ranges conservatively unless clearly global unicast (2000::/3)
    if (net.isIPv6(normalized)) {
      const firstHex = parseInt(normalized.split(':')[0] || '0', 16);
      const isGlobalUnicast = (firstHex & 0xe000) === 0x2000;
      return !isGlobalUnicast;
    }
    return true;
  }
  const octets = v4.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export interface TargetValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

export async function validateServerTarget(params: {
  host: string;
  port: number;
  protocol: 'https' | 'http';
  apiBaseUrl: string;
  environment: 'development' | 'staging' | 'production';
}): Promise<TargetValidationResult> {
  const { host, port, protocol, apiBaseUrl, environment } = params;

  if (environment === 'production' && protocol !== 'https') {
    return { valid: false, reason: 'Production endpoints must use HTTPS.' };
  }

  if (!ALLOWED_PORTS.has(port)) {
    return {
      valid: false,
      reason: `Port ${port} is outside the approved port allowlist (${Array.from(ALLOWED_PORTS).join(', ')}).`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    return { valid: false, reason: 'API base URL is malformed.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Only http and https protocols are permitted.' };
  }
  if (environment === 'production' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Production API base URL must use https://.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded credentials in server URLs are prohibited.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedHost = host.trim().toLowerCase();
  if (hostname !== normalizedHost) {
    return { valid: false, reason: 'Host field must match the API base URL hostname.' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { valid: false, reason: 'Loopback, local, and cloud metadata hosts are blocked.' };
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrDisallowedIp(hostname)) {
      return { valid: false, reason: 'Private, loopback, and link-local IP addresses are blocked.' };
    }
  } else {
    // Resolve DNS to prevent DNS rebinding or internal A/AAAA records
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records.length) {
        return { valid: false, reason: 'Hostname could not be resolved via DNS.' };
      }
      for (const rec of records) {
        if (isPrivateOrDisallowedIp(rec.address)) {
          return {
            valid: false,
            reason: `Hostname resolved to a disallowed private/internal IP address (${rec.address}).`,
          };
        }
      }
    } catch {
      return { valid: false, reason: 'DNS resolution failed for the specified hostname.' };
    }
  }

  return { valid: true, normalizedUrl: parsed.toString().replace(/\/$/, '') };
}

export interface HealthProbeResult {
  healthStatus: 'healthy' | 'degraded' | 'unreachable';
  latencyMs: number | null;
  httpStatus: number | null;
  checkedAt: string;
  detail: string;
}

export async function runControlledHealthCheck(params: {
  host: string;
  port: number;
  protocol: 'https' | 'http';
  apiBaseUrl: string;
  environment: 'development' | 'staging' | 'production';
}): Promise<HealthProbeResult> {
  const checkedAt = new Date().toISOString();
  const validation = await validateServerTarget(params);
  if (!validation.valid || !validation.normalizedUrl) {
    return {
      healthStatus: 'unreachable',
      latencyMs: null,
      httpStatus: null,
      checkedAt,
      detail: validation.reason || 'Endpoint rejected by security policy.',
    };
  }

  const probeUrl = `${validation.normalizedUrl}/api/v1/health/live`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const started = Date.now();

  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'manual', // Disallow unsafe redirects
      signal: controller.signal,
      headers: { 'User-Agent': 'ThinkPulse-HealthProbe/1.0' },
    });
    const latencyMs = Date.now() - started;
    clearTimeout(timeout);

    if (response.status >= 300 && response.status < 400) {
      return {
        healthStatus: 'degraded',
        latencyMs,
        httpStatus: response.status,
        checkedAt,
        detail: `Endpoint responded with redirect (${response.status}); redirects are not followed.`,
      };
    }

    if (response.ok) {
      return {
        healthStatus: 'healthy',
        latencyMs,
        httpStatus: response.status,
        checkedAt,
        detail: `HTTP ${response.status} OK in ${latencyMs}ms.`,
      };
    }

    return {
      healthStatus: 'degraded',
      latencyMs,
      httpStatus: response.status,
      checkedAt,
      detail: `Endpoint responded with HTTP ${response.status}.`,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const msg = err instanceof Error && err.name === 'AbortError'
      ? 'Health check timed out after 5000ms.'
      : 'Endpoint could not be reached.';
    return {
      healthStatus: 'unreachable',
      latencyMs: null,
      httpStatus: null,
      checkedAt,
      detail: msg,
    };
  }
}
