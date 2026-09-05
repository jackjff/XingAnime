export class SankaUpstreamError extends Error {
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'SankaUpstreamError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function numericStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

function responseMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  return typeof root.message === 'string' && root.message.trim() ? root.message.trim() : null;
}

const MIN_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 15 * 60_000;

function boundedRetryAfter(milliseconds: number): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, Math.ceil(milliseconds)));
}

export function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? boundedRetryAfter(milliseconds) : MAX_RETRY_AFTER_MS;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? boundedRetryAfter(timestamp - Date.now()) : null;
}

export async function readSankaJson(response: Response, operation: string): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SankaUpstreamError(
      `Sanka ${operation} returned a non-JSON response`,
      response.status,
      retryAfterMilliseconds(response)
    );
  }

  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const apiStatus = numericStatus(root?.statusCode) ?? numericStatus(root?.status);
  const status = response.ok ? apiStatus ?? response.status : response.status;
  const statusText = typeof root?.status === 'string' ? root.status.toLowerCase() : '';
  const failed = !response.ok
    || root?.ok === false
    || (apiStatus !== null && apiStatus >= 400)
    || ['error', 'failed', 'failure'].includes(statusText);

  if (failed || !root) {
    const message = responseMessage(payload) ?? (response.statusText || 'invalid response');
    throw new SankaUpstreamError(
      `Sanka ${operation} request failed with HTTP ${status}: ${message}`,
      status,
      retryAfterMilliseconds(response)
    );
  }

  return payload;
}

export class SankaCircuitBreaker {
  private openUntil = 0;
  private status: number | null = null;
  private retryAfterMs: number | null = null;

  isOpen(now = Date.now()): boolean {
    return this.openUntil > now;
  }

  createOpenError(operation: string, now = Date.now()): SankaUpstreamError {
    const remaining = Math.max(0, this.openUntil - now);
    return new SankaUpstreamError(
      `Sanka ${operation} circuit is open`,
      this.status,
      this.retryAfterMs ?? remaining
    );
  }

  open(status: number, retryAfterMs: number | null): void {
    const fallbackCooldown = status === 403 ? 15 * 60_000 : 60_000;
    const cooldown = Math.max(0, retryAfterMs ?? fallbackCooldown);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.openUntil = Math.max(this.openUntil, Date.now() + cooldown);
  }
}

export function isJsonObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Sanka wraps dead Otakudesu detail links as HTTP 500 with statusCode 404 and message
// "data tidak ditemukan". Those are definitive: hide the title. A bare 500 without that
// message stays transient (scraper hiccup) and must not hide anything.
export function isDefinitiveDeadLink(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as { name?: string; status?: number | null; message?: string };
  if (error.name !== 'SankaUpstreamError') return false;
  const status = error.status ?? null;
  if (status === 404 || status === 410) return true;
  return status === 500 && /data tidak ditemukan/i.test(error.message ?? '');
}
