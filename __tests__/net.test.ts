import { resilientFetch, NetworkTimeoutError } from '@/lib/net';

const ok = (status = 200) => ({ status } as unknown as Response);
const fast = { retries: 2, retryBaseMs: 1, retryMaxMs: 2, timeoutMs: 50 };

describe('resilientFetch', () => {
  it('returns a successful GET without retrying', async () => {
    const base = jest.fn(async () => ok(200));
    const r = await resilientFetch(base, fast)('http://x');
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent GET on a network error, then succeeds', async () => {
    const base = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(ok(200));
    const r = await resilientFetch(base, fast)('http://x');
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('retries an idempotent GET on a transient 5xx', async () => {
    const base = jest.fn().mockResolvedValueOnce(ok(503)).mockResolvedValueOnce(ok(200));
    const r = await resilientFetch(base, fast)('http://x');
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('never retries a write (POST)', async () => {
    const base = jest.fn().mockRejectedValue(new TypeError('network'));
    await expect(resilientFetch(base, fast)('http://x', { method: 'POST' })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('retries a POST when idempotent is forced true (JSON-RPC read)', async () => {
    const base = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(ok(200));
    const r = await resilientFetch(base, { ...fast, idempotent: true })('http://x', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('times out a hung request with NetworkTimeoutError (and retries the GET)', async () => {
    const base = jest.fn(() => new Promise<Response>(() => {})); // never resolves
    await expect(resilientFetch(base, { ...fast, retries: 1 })('http://x')).rejects.toBeInstanceOf(
      NetworkTimeoutError,
    );
    expect(base).toHaveBeenCalledTimes(2); // 1 attempt + 1 retry
  });

  it('does not start an attempt when the caller already aborted', async () => {
    const base = jest.fn(async () => ok(200));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(resilientFetch(base, fast)('http://x', { signal: ctrl.signal })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(0);
  });
});
