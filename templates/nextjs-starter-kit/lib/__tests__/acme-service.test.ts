import { describe, it, expect, vi } from 'vitest';
import { AcmeAccessService, type PeekAuthTokenClaims } from '@peektravel/app-utilities';

vi.mock('@/lib/env', () => ({
  parseEnv: () => ({
    PEEK_APP_SECRET: 'test-secret',
    PEEK_APP_ID: 'test-app-id',
    PEEK_APP_URL: 'https://app.example.com',
    PEEK_API_URL: 'https://api.example.com',
    NODE_ENV: 'test' as const,
  }),
}));

const { createAcmeService } = await import('../acme-service');

const mockAuth: PeekAuthTokenClaims = {
  installId: 'install-abc',
  displayVersion: '1.0',
  user: { email: 'user@example.com', id: 'user-1', name: 'Alice', isAdmin: false, locale: 'en', platform: 'acme' },
};

describe('createAcmeService', () => {
  it('returns an AcmeAccessService instance', () => {
    const service = createAcmeService(mockAuth);
    expect(service).toBeInstanceOf(AcmeAccessService);
  });

  it('uses installId from the auth claims', () => {
    const auth = { ...mockAuth, installId: 'install-xyz' };
    const service = createAcmeService(auth);
    expect(service).toBeInstanceOf(AcmeAccessService);
  });
});
