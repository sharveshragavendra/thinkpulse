// In-memory auth token storage (NEVER persisted to localStorage or sessionStorage)
let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
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
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers || {}),
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (inMemoryToken) {
    headers['Authorization'] = `Bearer ${inMemoryToken}`;
  }

  const response = await fetch(`/api/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

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

export async function downloadAuthenticatedCsv(path: string, fallbackFilename: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (inMemoryToken) {
    headers['Authorization'] = `Bearer ${inMemoryToken}`;
  }
  const response = await fetch(`/api/v1${path}`, { headers });
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
