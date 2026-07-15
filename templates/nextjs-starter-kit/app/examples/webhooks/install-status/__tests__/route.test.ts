import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Auth is exercised directly in lib/__tests__/webhook-auth.test.ts. Here we
// mock it so route tests focus on parsing, logging, and response.
const authResult = vi.hoisted(() => ({ current: {} as unknown }));

vi.mock('@/lib/webhook-auth', () => ({
  requirePeekWebhookAuth: () => authResult.current,
}));

const { POST } = await import('../route');

function makeRequest(body: string): NextRequest {
  return new NextRequest('http://localhost/examples/webhooks/install-status', {
    method: 'POST',
    body,
  });
}

const VALID_BODY = JSON.stringify({
  status: 'uninstalled',
  install_id: '8bd8fa02-a496-4866-a00a-e327f5f7c2e6',
  display_version: '1.0.2',
  account: { id: '1000001', name: 'Demo park', platform: 'cng', is_test: true },
});

describe('POST /examples/webhooks/install-status', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    authResult.current = { auth: { sub: 'install-abc-123', user: null } };
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('returns the auth error when the token is missing/invalid', async () => {
    authResult.current = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 200 { ok: true } for an authenticated delivery', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('logs a readable summary of the payload', async () => {
    await POST(makeRequest(VALID_BODY));
    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('uninstalled');
    expect(output).toContain('[TEST]');
    expect(output).toContain('Demo park');
    expect(output).toContain('1000001');
    expect(output).toContain('8bd8fa02-a496-4866-a00a-e327f5f7c2e6');
    expect(output).toContain('1.0.2');
  });

  it('omits the [TEST] marker for a live (non-test) account', async () => {
    const body = JSON.stringify({ status: 'installed', account: { is_test: false } });
    await POST(makeRequest(body));
    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(output).toContain('installed');
    expect(output).not.toContain('[TEST]');
  });

  it('throws on a non-JSON body (unhandled by design)', async () => {
    await expect(POST(makeRequest('not json'))).rejects.toThrow();
  });
});
