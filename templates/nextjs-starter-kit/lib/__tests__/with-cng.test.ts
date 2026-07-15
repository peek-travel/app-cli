import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { PeekAuthTokenClaims } from '@peektravel/app-utilities';

const mockRequirePeekAuth = vi.fn();
const mockCreateCngService = vi.fn();

vi.mock('@/lib/api-auth', () => ({ requirePeekAuth: mockRequirePeekAuth }));
vi.mock('@/lib/cng-service', () => ({ createCngService: mockCreateCngService }));

const { withCngAuthentication } = await import('../with-cng');

const fakeClaims: PeekAuthTokenClaims = {
  installId: 'install-abc',
  displayVersion: '1.0',
  user: { email: 'user@example.com', id: 'user-1', name: 'Alice', isAdmin: false, locale: 'en' },
};
const fakeCng = {} as never;
const fakeRequest = new NextRequest('http://localhost/api/test');

describe('withCngAuthentication', () => {
  it('returns the auth error response when requirePeekAuth fails', async () => {
    const errorResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockRequirePeekAuth.mockReturnValue({ error: errorResponse });

    const handler = vi.fn();
    const result = await withCngAuthentication(handler)(fakeRequest);

    expect(result.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls handler with cng service and auth claims on success', async () => {
    mockRequirePeekAuth.mockReturnValue({ auth: fakeClaims });
    mockCreateCngService.mockReturnValue(fakeCng);
    const handlerResponse = NextResponse.json({ ok: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const result = await withCngAuthentication(handler)(fakeRequest);

    expect(mockCreateCngService).toHaveBeenCalledWith(fakeClaims);
    expect(handler).toHaveBeenCalledWith(fakeRequest, fakeCng, fakeClaims);
    expect(result).toBe(handlerResponse);
  });
});
