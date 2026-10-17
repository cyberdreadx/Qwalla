/**
 * Resilient fetch — a per-attempt timeout on every request, and
 * exponential-backoff retry for IDEMPOTENT requests (GET/HEAD) on timeouts,
 * network errors and transient 5xx responses. Built for weak/flaky signal: a
 * request that would otherwise hang forever fails fast, and read requests heal
 * themselves across a brief drop.
 *
 * Writes (POST/PUT/PATCH/DELETE) get the timeout but are NEVER retried: a write
 * that times out may still have landed on the server, so re-sending it blindly
 * could double-apply it. Reliable writes (transaction / message broadcast) need
 * idempotency + status reconciliation — see the send outbox — not blind retry.
 */

type FetchFn = typeof fetch;

export interface ResilientOpts {
  /** Per-attempt timeout in ms (default 20s). */
  timeoutMs?: number;
  /** Max retries for idempotent requests (default 2 → up to 3 attempts). */
  retries?: number;
  /** First backoff delay in ms (default 500). */
  retryBaseMs?: number;
  /** Backoff ceiling in ms (default 4000). */
  retryMaxMs?: number;
  /**
   * Force retry-eligibility, overriding the HTTP-method heuristic. Needed for
   * JSON-RPC, where reads and writes are both POST: pass `true` for read
   * methods, `false` for a send. Omit to decide by method (GET/HEAD = retry).
   */
  idempotent?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 4_000;

/** Thrown when a request exceeds its per-attempt timeout (vs. a caller abort). */
export class NetworkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'NetworkTimeoutError';
  }
}

function isIdempotent(init?: RequestInit): boolean {
  const m = (init?.method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter, capped at `max`. */
function backoffDelay(attempt: number, base: number, max: number): number {
  const ceil = Math.min(max, base * 2 ** attempt);
  return ceil / 2 + Math.random() * (ceil / 2);
}

/**
 * Run one attempt of `base` with a hard timeout. Uses Promise.race so a timeout
 * rejects even if `base` ignores the abort signal (and still aborts the signal
 * best-effort to cancel the underlying request). A caller-supplied signal is
 * forwarded.
 */
async function attemptWithTimeout(
  base: FetchFn,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? undefined;
  if (callerSignal?.aborted) controller.abort();
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onCallerAbort);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NetworkTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([base(input, { ...init, signal: controller.signal }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Wrap a fetch implementation (default: the global `fetch`) with a timeout on
 * every request and backoff retry for idempotent requests. Drop-in for anywhere
 * a `fetch` is expected (e.g. the RougeChain SDK's `fetch` option).
 */
export function resilientFetch(base: FetchFn = fetch, opts: ResilientOpts = {}): FetchFn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryBase = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const retryMax = opts.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const canRetry = opts.idempotent !== undefined ? opts.idempotent : isIdempotent(init);
    const maxAttempts = canRetry ? retries + 1 : 1;
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // The caller gave up — don't start another attempt.
      if (init?.signal?.aborted) throw lastErr ?? new Error('Aborted');
      try {
        const res = await attemptWithTimeout(base, input, init, timeoutMs);
        // Retry idempotent requests on a transient server error.
        if (canRetry && res.status >= 500 && res.status < 600 && attempt < maxAttempts - 1) {
          lastErr = new Error(`HTTP ${res.status}`);
          await sleep(backoffDelay(attempt, retryBase, retryMax));
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        // A caller abort (not our timeout) is final — never retry it.
        if (init?.signal?.aborted) throw err;
        if (!canRetry || attempt >= maxAttempts - 1) throw err;
        await sleep(backoffDelay(attempt, retryBase, retryMax));
      }
    }
    throw lastErr ?? new Error('fetch failed');
  };

  return wrapped as FetchFn;
}
