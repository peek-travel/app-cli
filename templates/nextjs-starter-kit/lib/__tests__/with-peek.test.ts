import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { PeekAuthTokenClaims } from '@peektravel/app-utilities';

const mockRequirePeekAuth = vi.fn();
const mockCreatePeekService = vi.fn();

vi.mock('@/lib/api-auth', () => ({ requirePeekAuth: mockRequirePeekAuth }));
vi.mock('@/lib/peek-service', () => ({ createPeekService: mockCreatePeekService }));

const { withPeekAuthentication } = await import('../with-peek');

const fakeClaims: PeekAuthTokenClaims = {
  installId: 'install-abc',
  displayVersion: '1.0',
  user: { email: 'user@example.com', id: 'user-1', name: 'Alice', isAdmin: false, locale: 'en' },
};
const fakePeek = {} as never;
const fakeRequest = new NextRequest('http://localhost/api/test');

describe('withPeekAuthentication', () => {
  it('returns the auth error response when requirePeekAuth fails', async () => {
    const errorResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockRequirePeekAuth.mockReturnValue({ error: errorResponse });

    const handler = vi.fn();
    const result = await withPeekAuthentication(handler)(fakeRequest);

    expect(result.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls handler with peek service and auth claims on success', async () => {
    mockRequirePeekAuth.mockReturnValue({ auth: fakeClaims });
    mockCreatePeekService.mockReturnValue(fakePeek);
    const handlerResponse = NextResponse.json({ ok: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const result = await withPeekAuthentication(handler)(fakeRequest);

    expect(mockCreatePeekService).toHaveBeenCalledWith(fakeClaims);
    expect(handler).toHaveBeenCalledWith(fakeRequest, fakePeek, fakeClaims);
    expect(result).toBe(handlerResponse);
  });
});
