import { describe, it, expect, vi } from 'vitest';
import { CngAccessService, type PeekAuthTokenClaims } from '@peektravel/app-utilities';

vi.mock('@/lib/env', () => ({
  parseEnv: () => ({
    PEEK_APP_SECRET: 'test-secret',
    PEEK_APP_ID: 'test-app-id',
    PEEK_APP_URL: 'https://app.example.com',
    PEEK_API_URL: 'https://api.example.com',
    NODE_ENV: 'test' as const,
  }),
}));

const { createCngService } = await import('../cng-service');

const mockAuth: PeekAuthTokenClaims = {
  installId: 'install-abc',
  displayVersion: '1.0',
  user: { email: 'user@example.com', id: 'user-1', name: 'Alice', isAdmin: false, locale: 'en', platform: 'cng' },
};

describe('createCngService', () => {
  it('returns a CngAccessService instance', () => {
    const service = createCngService(mockAuth);
    expect(service).toBeInstanceOf(CngAccessService);
  });

  it('uses installId from the auth claims', () => {
    const auth = { ...mockAuth, installId: 'install-xyz' };
    const service = createCngService(auth);
    expect(service).toBeInstanceOf(CngAccessService);
  });
});
