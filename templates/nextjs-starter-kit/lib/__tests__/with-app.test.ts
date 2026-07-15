import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { PeekAuthTokenClaims } from '@peektravel/app-utilities';

const mockRequirePeekAuth = vi.fn();
const mockCreateAppService = vi.fn();

vi.mock('@/lib/api-auth', () => ({ requirePeekAuth: mockRequirePeekAuth }));
vi.mock('@/lib/app-service', () => ({ createAppService: mockCreateAppService }));

const { withAppAuthentication } = await import('../with-app');

const fakeClaims: PeekAuthTokenClaims = {
  installId: 'install-abc',
  displayVersion: '1.0',
  user: {
    email: 'user@example.com',
    id: 'user-1',
    name: 'Alice',
    isAdmin: false,
    locale: 'en',
    platform: 'cng',
  },
};
const fakeService = {} as never;
const fakeRequest = new NextRequest('http://localhost/api/test');

describe('withAppAuthentication', () => {
  it('returns the auth error response when requirePeekAuth fails', async () => {
    const errorResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockRequirePeekAuth.mockReturnValue({ error: errorResponse });

    const handler = vi.fn();
    const result = await withAppAuthentication(handler)(fakeRequest);

    expect(result.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('factories the platform accessor and calls handler with it and the claims', async () => {
    mockRequirePeekAuth.mockReturnValue({ auth: fakeClaims });
    mockCreateAppService.mockReturnValue(fakeService);
    const handlerResponse = NextResponse.json({ ok: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const result = await withAppAuthentication(handler)(fakeRequest);

    expect(mockCreateAppService).toHaveBeenCalledWith(fakeClaims);
    expect(handler).toHaveBeenCalledWith(fakeRequest, fakeService, fakeClaims);
    expect(result).toBe(handlerResponse);
  });
});
