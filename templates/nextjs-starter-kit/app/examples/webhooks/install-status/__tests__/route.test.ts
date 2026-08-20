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

const INSTALL_ID = 'cf34832d-16ea-4197-86fd-bf63e6917348';
const ACCOUNT_ID = '4b52e9d2-7411-4d47-9100-71bebb55d151';
const API_URL =
  'https://app-registry.sandbox.peeklabs.com/installations-api/google-things-to-do-integration-test-dev';

// The signed `app_registry_v2` token authenticates the whole delivery and backs
// up the fields the body also carries (sub, account.id, status, version, user).
function makeToken(overrides: Record<string, unknown> = {}, secret = TEST_SECRET): string {
  return jwt.sign(
    {
      iss: 'app_registry_v2',
      aud: 'Joken',
      sub: INSTALL_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      status: 'installed',
      display_version: '1.0.3',
      account: { id: ACCOUNT_ID },
      user: null,
      ...overrides,
    },
    secret,
    { algorithm: 'HS256', noTimestamp: true }
  );
}

// The JSON body is the source of the event data — including api.url, the account
// block (with timezone), and modified_by.
function makeBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: 'installed',
    install_id: INSTALL_ID,
    display_version: '1.0.3',
    api: { url: API_URL },
    account: {
      id: ACCOUNT_ID,
      name: "Oskar's Boat Tours",
      timezone: 'America/New_York',
      is_test: true,
      platform: 'peek',
    },
    ...overrides,
  });
}

function makeRequest(token: string | null, body: string = makeBody()): NextRequest {
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

  const logged = () => logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

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

  it('tolerates a `Bearer ` prefix on the header token', async () => {
    const res = await POST(makeRequest(`Bearer ${makeToken()}`));
    expect(res.status).toBe(200);
  });

  it('logs the event — including apiUrl and timezone from the body', async () => {
    await POST(makeRequest(makeToken()));
    const out = logged();
    expect(out).toContain('installed'); // status
    expect(out).toContain('[TEST]'); // is_test
    expect(out).toContain("Oskar's Boat Tours"); // account.name
    expect(out).toContain(ACCOUNT_ID); // account.id
    expect(out).toContain('America/New_York'); // account.timezone
    expect(out).toContain(API_URL); // api.url — the per-install endpoint
    expect(out).toContain(INSTALL_ID); // install_id
    expect(out).toContain('1.0.3'); // display_version
  });

  it('takes shared fields from the body (the body is the source of event data)', async () => {
    // A verified token authenticates the delivery; the body carries the event.
    const body = makeBody({ account: { id: 'BODY-ACCOUNT', name: 'Body Co', platform: 'peek' } });
    await POST(makeRequest(makeToken({ account: { id: ACCOUNT_ID } }), body));
    const out = logged();
    expect(out).toContain('BODY-ACCOUNT'); // from the body
    expect(out).toContain('Body Co');
  });

  it('falls back to the token for shared fields the body omits', async () => {
    // Body omits install_id -> parseInstallWebhook uses the token `sub`.
    const body = makeBody({ install_id: undefined });
    await POST(makeRequest(makeToken({ sub: INSTALL_ID }), body));
    expect(logged()).toContain(INSTALL_ID);
  });

  it('fails loud (500) on a status this package version does not recognize', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest(makeToken(), makeBody({ status: 'suspended' })));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unknown status: suspended' });
    errSpy.mockRestore();
  });
});
