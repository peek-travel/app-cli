import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-secret-for-api-auth';
const TEST_APP_ID = 'test-app-id';

vi.mock('@/lib/env', () => ({
  parseEnv: () => ({
    PEEK_APP_SECRET: TEST_SECRET,
    PEEK_APP_ID: TEST_APP_ID,
    PEEK_APP_URL: 'https://app.example.com',
    PEEK_API_URL: 'https://api.example.com',
    NODE_ENV: 'test' as const,
  }),
}));

const { requirePeekAuth } = await import('../api-auth');

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      iss: 'app_registry_v2',
      sub: 'install-abc-123',
      exp: Math.floor(Date.now() / 1000) + 3600,
      display_version: '1.0',
      user: { email: 'user@example.com', id: 'user-xyz', name: 'Alice', is_admin: false, locale: 'en' },
      ...overrides,
    },
    TEST_SECRET,
    { algorithm: 'HS256', noTimestamp: true }
  );
}

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/activities', {
    headers: authHeader ? { 'x-peek-auth': authHeader } : {},
  });
}

describe('requirePeekAuth', () => {
  describe('success cases', () => {
    it('returns auth for a valid Bearer token', () => {
      const token = makeToken();
      const result = requirePeekAuth(makeRequest(`Bearer ${token}`));
      expect('error' in result).toBe(false);
      const { auth } = result as { auth: { installId: string; user: { email: string } } };
      expect(auth.installId).toBe('install-abc-123');
      expect(auth.user.email).toBe('user@example.com');
    });

    it('accepts a raw token without Bearer prefix', () => {
      const token = makeToken();
      const result = requirePeekAuth(makeRequest(token));
      expect('error' in result).toBe(false);
    });
  });

  describe('failure cases', () => {
    it('returns 401 when x-peek-auth header is absent', async () => {
      const result = requirePeekAuth(makeRequest());
      expect('error' in result).toBe(true);
      const { error } = result as { error: Response };
      expect(error.status).toBe(401);
      const body = await error.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 for an expired token', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
      const result = requirePeekAuth(makeRequest(`Bearer ${token}`));
      expect('error' in result).toBe(true);
      const { error } = result as { error: Response };
      expect(error.status).toBe(401);
    });

    it('returns 401 for a wrong-secret token', async () => {
      const token = jwt.sign(
        { iss: 'app_registry_v2', sub: 'x', exp: Math.floor(Date.now() / 1000) + 3600 },
        'wrong-secret',
        { algorithm: 'HS256', noTimestamp: true }
      );
      const result = requirePeekAuth(makeRequest(`Bearer ${token}`));
      expect('error' in result).toBe(true);
      const { error } = result as { error: Response };
      expect(error.status).toBe(401);
    });

    it('returns 401 for a tampered token', async () => {
      const token = makeToken();
      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}TAMPERED.${parts[2]}`;
      const result = requirePeekAuth(makeRequest(`Bearer ${tampered}`));
      expect('error' in result).toBe(true);
      const { error } = result as { error: Response };
      expect(error.status).toBe(401);
    });

    it('returns 401 for a garbage token string', async () => {
      const result = requirePeekAuth(makeRequest('Bearer not-a-jwt'));
      expect('error' in result).toBe(true);
      const { error } = result as { error: Response };
      expect(error.status).toBe(401);
    });
  });
});
