import { type NextRequest, NextResponse } from 'next/server';
import { type PeekAuthTokenClaims } from '@peektravel/app-utilities';
import { verifyPeekAuthToken } from '@/lib/peek-service';

type AuthSuccess = { auth: PeekAuthTokenClaims };
type AuthFailure = { error: NextResponse };

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export function requirePeekAuth(request: NextRequest): AuthSuccess | AuthFailure {
  const header = request.headers.get('x-peek-auth');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : header ?? null;

  if (!token) {
    return { error: unauthorized() };
  }

  try {
    const auth = verifyPeekAuthToken(token);
    return { auth };
  } catch {
    return { error: unauthorized() };
  }
}
