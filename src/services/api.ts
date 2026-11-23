const TOKEN_STORAGE_KEY = 'tp_auth_token';

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restrictions
  }
}

let cachedToken: string | null = readStoredToken();
let tokenRefresher: (() => Promise<string | null>) | null = null;
let inflightRefresh: Promise<string | null> | null = null;

export function setAuthToken(token: string | null) {
  cachedToken = token;
  writeStoredToken(token);
}

export function getAuthToken(): string | null {
  if (!cachedToken) {
    cachedToken = readStoredToken();
  }
  return cachedToken;
}

export function setTokenRefresher(fn: (() => Promise<string | null>) | null) {
  tokenRefresher = fn;
}

async function refreshAuthTokenOnce(): Promise<string | null> {
  if (!tokenRefresher) return null;
  if (!inflightRefresh) {
    inflightRefresh = tokenRefresher().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    _retried?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers || {}),
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // Transparently refresh token on 401 so tab switches or cold starts never show "session expired"
  if (response.status === 401 && !options._retried && !path.startsWith('/auth/')) {
    const newToken = await refreshAuthTokenOnce();
    if (newToken) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    let data: Record<string, unknown> | undefined;
    if (contentType.includes('application/json')) {
      try {
        data = (await response.json()) as Record<string, unknown>;
        if (typeof data.error === 'string') message = data.error;
        if (typeof data.code === 'string') code = data.code;
      } catch {
        // ignore parse errors
      }
    }
    throw new ApiError(message, response.status, code, data);
  }

  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export async function downloadAuthenticatedCsv(
  path: string,
  fallbackFilename: string,
  retried = false
): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`/api/v1${path}`, { headers });
  if (response.status === 401 && !retried) {
    const newToken = await refreshAuthTokenOnce();
    if (newToken) {
      return downloadAuthenticatedCsv(path, fallbackFilename, true);
    }
  }
  if (!response.ok) {
    throw new ApiError('Unable to export CSV file.', response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
