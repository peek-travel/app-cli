import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-secret-for-webhook-auth';

vi.mock('@/lib/env', () => ({
  parseEnv: () => ({
    PEEK_APP_SECRET: TEST_SECRET,
    PEEK_APP_ID: 'test-app-id',
    PEEK_APP_URL: 'https://app.example.com',
    PEEK_API_URL: 'https://api.example.com',
    NODE_ENV: 'test' as const,
  }),
}));

const { requirePeekWebhookAuth } = await import('../webhook-auth');

// Webhook tokens carry NO user (system events) — user: null. This is the exact
// shape the live install-status webhook delivers.
function makeToken(overrides: Record<string, unknown> = {}, secret = TEST_SECRET): string {
  return jwt.sign(
    {
      iss: 'app_registry_v2',
      aud: 'Joken',
      sub: 'install-abc-123',
      display_version: '1.0.2',
      user: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    },
    secret,
    { algorithm: 'HS256', noTimestamp: true },
  );
}

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/examples/webhooks/install-status', {
    method: 'POST',
    headers: authHeader ? { 'x-peek-auth': authHeader } : {},
  });
}

describe('requirePeekWebhookAuth', () => {
  describe('success cases', () => {
    it('verifies a userless webhook token (user: null) without throwing', () => {
      const result = requirePeekWebhookAuth(makeRequest(`Bearer ${makeToken()}`));
      expect('error' in result).toBe(false);
      const { auth } = result as { auth: { sub: string; user: unknown } };
      expect(auth.sub).toBe('install-abc-123');
      expect(auth.user).toBeNull();
    });

    it('accepts a raw token without the Bearer prefix', () => {
      const result = requirePeekWebhookAuth(makeRequest(makeToken()));
      expect('error' in result).toBe(false);
    });
  });

  describe('failure cases', () => {
    it('returns 401 when x-peek-auth header is absent', async () => {
      const result = requirePeekWebhookAuth(makeRequest());
      const { error } = result as { error: Response };
      expect(error.status).toBe(401);
      expect(await error.json()).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 for an expired token', () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
      const result = requirePeekWebhookAuth(makeRequest(`Bearer ${token}`));
      expect((result as { error: Response }).error.status).toBe(401);
    });

    it('returns 401 for a wrong-secret token', () => {
      const token = makeToken({}, 'wrong-secret');
      const result = requirePeekWebhookAuth(makeRequest(`Bearer ${token}`));
      expect((result as { error: Response }).error.status).toBe(401);
    });

    it('returns 401 for a wrong issuer', () => {
      const token = makeToken({ iss: 'someone-else' });
      const result = requirePeekWebhookAuth(makeRequest(`Bearer ${token}`));
      expect((result as { error: Response }).error.status).toBe(401);
    });

    it('returns 401 for a wrong audience', () => {
      const token = makeToken({ aud: 'not-joken' });
      const result = requirePeekWebhookAuth(makeRequest(`Bearer ${token}`));
      expect((result as { error: Response }).error.status).toBe(401);
    });

    it('returns 401 for a tampered token', () => {
      const parts = makeToken().split('.');
      const tampered = `${parts[0]}.${parts[1]}TAMPERED.${parts[2]}`;
      const result = requirePeekWebhookAuth(makeRequest(`Bearer ${tampered}`));
      expect((result as { error: Response }).error.status).toBe(401);
    });

    it('returns 401 for a garbage token string', () => {
      const result = requirePeekWebhookAuth(makeRequest('Bearer not-a-jwt'));
      expect((result as { error: Response }).error.status).toBe(401);
    });
  });
});
