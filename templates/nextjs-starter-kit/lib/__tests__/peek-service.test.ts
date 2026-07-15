import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { PeekAccessService, type PeekAuthTokenClaims } from '@peektravel/app-utilities';

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

const { createPeekService, verifyPeekAuthToken } = await import('../peek-service');

const mockAuth: PeekAuthTokenClaims = {
  installId: 'install-abc',
  displayVersion: '1.0',
  user: { email: 'user@example.com', id: 'user-1', name: 'Alice', isAdmin: false, locale: 'en' },
};

describe('createPeekService', () => {
  it('returns a PeekAccessService instance', () => {
    const service = createPeekService(mockAuth);
    expect(service).toBeInstanceOf(PeekAccessService);
  });

  it('uses installId from the auth claims', () => {
    const auth = { ...mockAuth, installId: 'install-xyz' };
    const service = createPeekService(auth);
    expect(service).toBeInstanceOf(PeekAccessService);
  });
});

describe('verifyPeekAuthToken', () => {
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

  it('returns the claims for a valid token', () => {
    const auth = verifyPeekAuthToken(makeToken());
    expect(auth.installId).toBe('install-abc-123');
    expect(auth.user.email).toBe('user@example.com');
  });

  it('throws for a wrong-secret token', () => {
    const token = jwt.sign(
      { iss: 'app_registry_v2', sub: 'x', exp: Math.floor(Date.now() / 1000) + 60 },
      'wrong-secret',
      { algorithm: 'HS256', noTimestamp: true }
    );
    expect(() => verifyPeekAuthToken(token)).toThrow();
  });

  it('throws for a garbage token string', () => {
    expect(() => verifyPeekAuthToken('not-a-jwt')).toThrow();
  });
});
