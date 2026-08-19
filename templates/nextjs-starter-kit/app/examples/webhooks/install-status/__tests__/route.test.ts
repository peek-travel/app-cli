import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

const TEST_SECRET = 'test-secret';

vi.mock('@/lib/env', () => ({
  parseEnv: () => ({
    PEEK_APP_SECRET: TEST_SECRET,
    PEEK_APP_ID: 'test-app-id',
    PEEK_APP_URL: 'https://app.example.com',
    PEEK_API_URL: 'https://api.example.com',
    NODE_ENV: 'test' as const,
  }),
}));

const { POST } = await import('../route');

// The signed `app_registry_v2` token carries the authoritative identity
// (installId=sub, accountId=account.id, status, display_version, user).
function makeToken(overrides: Record<string, unknown> = {}, secret = TEST_SECRET): string {
  return jwt.sign(
    {
      iss: 'app_registry_v2',
      aud: 'Joken',
      sub: '8bd8fa02-a496-4866-a00a-e327f5f7c2e6',
      exp: Math.floor(Date.now() / 1000) + 3600,
      status: 'uninstalled',
      display_version: '1.0.2',
      account: { id: '1000001' },
      user: null,
      ...overrides,
    },
    secret,
    { algorithm: 'HS256', noTimestamp: true }
  );
}

// The unsigned JSON body is the enrichment channel — trusted only for the
// account name / platform / test flag.
const BODY = JSON.stringify({
  status: 'uninstalled',
  install_id: '8bd8fa02-a496-4866-a00a-e327f5f7c2e6',
  display_version: '1.0.2',
  account: { id: '1000001', name: 'Demo park', platform: 'cng', is_test: true },
});

function makeRequest(token: string | null, body: string = BODY): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== null) headers['x-peek-auth'] = token;
  return new NextRequest('http://localhost/examples/webhooks/install-status', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /examples/webhooks/install-status', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('returns 401 when the token is missing', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(401);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is signed with the wrong secret', async () => {
    const res = await POST(makeRequest(makeToken({}, 'wrong-secret')));
    expect(res.status).toBe(401);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 200 { ok: true } for a verified delivery', async () => {
    const res = await POST(makeRequest(makeToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('logs identity — status/id/version from the token, name/platform/test from the body', async () => {
    await POST(makeRequest(makeToken()));
    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('uninstalled'); // token status
    expect(output).toContain('[TEST]'); // body is_test
    expect(output).toContain('Demo park'); // body account.name
    expect(output).toContain('1000001'); // token account.id
    expect(output).toContain('8bd8fa02-a496-4866-a00a-e327f5f7c2e6'); // token sub
    expect(output).toContain('1.0.2'); // token display_version
  });

  it('omits the [TEST] marker for a live (non-test) account', async () => {
    const body = JSON.stringify({ account: { is_test: false } });
    await POST(makeRequest(makeToken({ status: 'installed' }), body));
    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('installed');
    expect(output).not.toContain('[TEST]');
  });

  it('takes identity from the token, never the body (a forged body cannot override it)', async () => {
    const forgedBody = JSON.stringify({
      account: { id: 'ATTACKER', name: 'Evil', platform: 'peek', is_test: false },
    });
    await POST(makeRequest(makeToken({ account: { id: '1000001' } }), forgedBody));
    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('1000001'); // authoritative account id, from the token
    expect(output).not.toContain('ATTACKER');
  });

  it('fails loud (500) on a status this package version does not recognize', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest(makeToken({ status: 'suspended' })));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unknown status: suspended' });
    errSpy.mockRestore();
  });
});
