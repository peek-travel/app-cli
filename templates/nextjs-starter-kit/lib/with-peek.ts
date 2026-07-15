import { type NextRequest, NextResponse } from 'next/server';
import { type PeekAccessService, type PeekAuthTokenClaims } from '@peektravel/app-utilities';
import { requirePeekAuth } from '@/lib/api-auth';
import { createPeekService } from '@/lib/peek-service';

type PeekHandler = (
  request: NextRequest,
  peek: PeekAccessService,
  auth: PeekAuthTokenClaims,
) => Promise<NextResponse>;

export function withPeekAuthentication(handler: PeekHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = requirePeekAuth(request);
    if ('error' in result) return result.error;
    const peek = createPeekService(result.auth);
    return handler(request, peek, result.auth);
  };
}
