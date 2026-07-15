import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** A trusted Peek parent origin the SPA is embedded under. */
const PEEK_PARENT = 'https://back-office.dev.peek.com';

let messageHandler: ((e: MessageEvent) => void) | null = null;
const mockAddEventListener = vi.fn((event: string, handler: EventListenerOrEventListenerObject) => {
  if (event === 'message') messageHandler = handler as (e: MessageEvent) => void;
});
const mockRemoveEventListener = vi.fn();
const mockParentPostMessage = vi.fn();

Object.defineProperty(global, 'window', {
  value: {
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
    parent: { postMessage: mockParentPostMessage },
    location: { ancestorOrigins: [PEEK_PARENT] },
  },
  configurable: true,
  writable: true,
});

/** Deliver a message to the SPA's handler with a trusted Peek origin. */
function deliver(data: unknown, origin: string = PEEK_PARENT): void {
  messageHandler?.({ data, origin } as MessageEvent);
}

const { requestToken, apiFetch, isPeekOrigin } = await import('../api');

function makeResponse(status: number, body: unknown, ok?: boolean): Response {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Prime the module's cached token by driving the requestToken handshake. */
async function primeToken(token: string): Promise<void> {
  const p = requestToken();
  deliver({ type: 'peek-token-response', token });
  await p;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockAddEventListener.mockClear();
  mockRemoveEventListener.mockClear();
  mockParentPostMessage.mockClear();
  messageHandler = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isPeekOrigin', () => {
  it('accepts peek.com / peek.stack at any subdomain depth and the apex', () => {
    for (const o of [
      'https://peek.com',
      'https://foo.peek.com',
      'https://foo.dev.peek.com',
      'https://foo.stage.peek.com',
      'https://peek.stack',
      'https://a.b.c.peek.stack',
      'http://foo.peek.com',
    ]) {
      expect(isPeekOrigin(o)).toBe(true);
    }
  });

  it('accepts connectngo.com and the fixed set of connectngo-<env>.com at any depth and apex', () => {
    for (const o of [
      'https://connectngo.com',
      'https://foo.connectngo.com',
      'https://a.b.c.connectngo.com',
      'https://connectngo-staging.com',
      'https://foo.connectngo-staging.com',
      'https://connectngo-demo.com',
      'https://foo.connectngo-qa.com',
      'https://connectngo-training.com',
      'http://foo.connectngo.com',
    ]) {
      expect(isPeekOrigin(o)).toBe(true);
    }
  });

  it('accepts acmeticketing.net / .com at any subdomain depth and the apex', () => {
    for (const o of [
      'https://acmeticketing.net',
      'https://foo.acmeticketing.net',
      'https://a.b.c.acmeticketing.net',
      'http://foo.acmeticketing.net',
      'https://acmeticketing.com',
      'https://foo.acmeticketing.com',
    ]) {
      expect(isPeekOrigin(o)).toBe(true);
    }
  });

  it('rejects non-Peek and look-alike origins', () => {
    for (const o of [
      'https://evil.com',
      'https://notpeek.com',
      'https://peek.com.evil.com',
      'https://peekacom',
      'https://peek.io',
      'https://notconnectngo.com',
      'https://connectngo.com.evil.com',
      'https://xconnectngo-staging.com',
      'https://connectngo-prod.com',
      'https://connectngo-evil.com',
      'https://connectngo.io',
      'https://acmeticketing.net.evil.com',
      'https://notacmeticketing.net',
      'https://acmeticketing.io',
      '',
    ]) {
      expect(isPeekOrigin(o)).toBe(false);
    }
  });
});

describe('requestToken', () => {
  it('posts a refresh request to the verified Peek parent origin (never "*")', async () => {
    const p = requestToken();
    expect(mockParentPostMessage).toHaveBeenCalledWith(
      { type: 'peek-iframe-token-refresh' },
      PEEK_PARENT,
    );
    deliver({ type: 'peek-token-response', token: 'fresh-token' });
    await expect(p).resolves.toBe('fresh-token');
    expect(mockRemoveEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('ignores messages with the wrong type or a non-string token, then times out', async () => {
    const p = requestToken();
    deliver({ type: 'other-event', token: 'ignored' });
    deliver({ type: 'peek-token-response', token: 12345 });
    vi.advanceTimersByTime(5001);
    await expect(p).rejects.toThrow('Token refresh timed out');
    expect(mockRemoveEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('ignores a token response from a non-Peek origin, then times out', async () => {
    const p = requestToken();
    deliver({ type: 'peek-token-response', token: 'evil' }, 'https://evil.example.com');
    deliver({ type: 'peek-token-response', token: 'also-evil' }, 'https://notpeek.com');
    vi.advanceTimersByTime(5001);
    await expect(p).rejects.toThrow('Token refresh timed out');
  });

  it('caches the token so subsequent apiFetch calls send it as a Bearer header', async () => {
    await primeToken('my-token');
    mockFetch.mockResolvedValue(makeResponse(200, { data: 'ok' }));
    await apiFetch('/test');
    expect(mockFetch).toHaveBeenCalledWith(
      '/test',
      expect.objectContaining({ headers: { 'x-peek-auth': 'Bearer my-token' } }),
    );
  });
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    await primeToken('tok');
    mockFetch.mockResolvedValue(makeResponse(200, { result: 42 }));
    const data = await apiFetch('/api/data');
    expect(data).toEqual({ result: 42 });
  });

  it('throws with error message from body on non-ok non-401 response', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, { error: 'Server exploded' }, false));
    await expect(apiFetch('/api/fail')).rejects.toThrow('Server exploded');
  });

  it('throws generic message when non-ok response body has no error field', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, {}, false));
    await expect(apiFetch('/api/fail')).rejects.toThrow('Request failed');
  });

  it('throws generic message when non-ok response body cannot be parsed', async () => {
    const res = {
      status: 503,
      ok: false,
      json: () => Promise.reject(new Error('invalid json')),
    } as unknown as Response;
    mockFetch.mockResolvedValue(res);
    await expect(apiFetch('/api/fail')).rejects.toThrow('Request failed');
  });

  describe('401 → token refresh flow', () => {
    it('retries with new token and returns data on success', async () => {
      const refreshedToken = 'new-token';

      mockFetch
        .mockResolvedValueOnce(makeResponse(401, {}, false))   // initial 401
        .mockResolvedValueOnce(makeResponse(200, { ok: true })); // retry

      const fetchPromise = apiFetch('/api/secure');

      // Let the 401 path execute and reach requestToken
      await Promise.resolve();
      await Promise.resolve();

      // Simulate Peek Pro sending back the new token
      deliver({ type: 'peek-token-response', token: refreshedToken });

      const result = await fetchPromise;
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        '/api/secure',
        expect.objectContaining({ headers: { 'x-peek-auth': `Bearer ${refreshedToken}` } }),
      );
    });

    it('throws when retry fails after token refresh', async () => {
      const refreshedToken = 'refreshed';

      mockFetch
        .mockResolvedValueOnce(makeResponse(401, {}, false))
        .mockResolvedValueOnce(makeResponse(403, {}, false));

      const fetchPromise = apiFetch('/api/secure');
      await Promise.resolve();
      await Promise.resolve();

      deliver({ type: 'peek-token-response', token: refreshedToken });

      await expect(fetchPromise).rejects.toThrow('Something went wrong');
    });

    it('rejects when token refresh times out', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(401, {}, false));

      const fetchPromise = apiFetch('/api/secure');
      await Promise.resolve();
      await Promise.resolve();

      vi.advanceTimersByTime(5001);
      await expect(fetchPromise).rejects.toThrow('Token refresh timed out');
      expect(mockRemoveEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });
});
