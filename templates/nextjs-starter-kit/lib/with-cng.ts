import { type NextRequest, NextResponse } from 'next/server';
import { type CngAccessService, type PeekAuthTokenClaims } from '@peektravel/app-utilities';
import { requirePeekAuth } from '@/lib/api-auth';
import { createCngService } from '@/lib/cng-service';

type CngHandler = (
  request: NextRequest,
  cng: CngAccessService,
  auth: PeekAuthTokenClaims,
) => Promise<NextResponse>;

/**
 * The CNG counterpart to {@link import("@/lib/with-peek").withPeekAuthentication}.
 *
 * Token verification is brand-agnostic — the peek-auth JWT is minted by the app
 * registry for every platform — so this reuses `requirePeekAuth`, then hands the
 * route a CngAccessService bound to the authenticated install instead of a
 * PeekAccessService.
 */
export function withCngAuthentication(handler: CngHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = requirePeekAuth(request);
    if ('error' in result) return result.error;
    const cng = createCngService(result.auth);
    return handler(request, cng, result.auth);
  };
}
