import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PeekAuthTokenClaims } from '@peektravel/app-utilities';

const mockCreatePeekService = vi.fn();
const mockCreateCngService = vi.fn();

vi.mock('@/lib/peek-service', () => ({ createPeekService: mockCreatePeekService }));
vi.mock('@/lib/cng-service', () => ({ createCngService: mockCreateCngService }));

const { createAppService } = await import('../app-service');

const claimsFor = (platform: string): PeekAuthTokenClaims => ({
  installId: 'install-abc',
  displayVersion: '1.0',
  user: {
    email: 'user@example.com',
    id: 'user-1',
    name: 'Alice',
    isAdmin: false,
    locale: 'en',
    platform: platform as 'peek' | 'cng' | 'acme',
  },
});

describe('createAppService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a Peek service for the peek platform', () => {
    const peek = {} as never;
    mockCreatePeekService.mockReturnValue(peek);
    const claims = claimsFor('peek');

    expect(createAppService(claims)).toBe(peek);
    expect(mockCreatePeekService).toHaveBeenCalledWith(claims);
    expect(mockCreateCngService).not.toHaveBeenCalled();
  });

  it('builds a CNG service for the cng platform', () => {
    const cng = {} as never;
    mockCreateCngService.mockReturnValue(cng);
    const claims = claimsFor('cng');

    expect(createAppService(claims)).toBe(cng);
    expect(mockCreateCngService).toHaveBeenCalledWith(claims);
    expect(mockCreatePeekService).not.toHaveBeenCalled();
  });

  it('throws for a platform with no accessor', () => {
    expect(() => createAppService(claimsFor('acme'))).toThrow(/acme/);
  });
});
