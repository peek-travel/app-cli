import { type NextRequest, NextResponse } from "next/server";
import { type PeekAuthTokenClaims } from "@peektravel/app-utilities";
import { requirePeekAuth } from "@/lib/api-auth";
import { type AppAccessService, createAppService } from "@/lib/app-service";

type AppHandler<T extends AppAccessService> = (
  request: NextRequest,
  service: T,
  auth: PeekAuthTokenClaims,
) => Promise<NextResponse>;

/**
 * Unified auth wrapper for every platform this app is embedded into (Peek,
 * Connect&GO, ...). Replaces the per-platform `withPeekAuthentication` /
 * `withCngAuthentication` wrappers: verify the brand-agnostic peek-auth JWT
 * once, then factory the accessor that matches the token's `platform` claim and
 * hand it to the route.
 *
 * The accessor's runtime type always matches the caller's platform, and a route
 * lives under exactly one platform's tree — so it already KNOWS which service it
 * gets. Name that type at the call site and the handler sees the concrete
 * accessor, no narrowing:
 *
 * ```ts
 * export const GET = withAppAuthentication<CngAccessService>(
 *   async (_request, cng) => { ... }, // cng is a CngAccessService
 * );
 * ```
 *
 * Omit the type argument to receive the `AppAccessService` union and inspect it
 * yourself (`service instanceof PeekAccessService`).
 */
export function withAppAuthentication<
  T extends AppAccessService = AppAccessService,
>(handler: AppHandler<T>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = requirePeekAuth(request);
    if ("error" in result) return result.error;
    // The caller declares the platform its route serves; the factory returns the
    // matching accessor at runtime. `as T` is that contract made explicit.
    const service = createAppService(result.auth) as T;
    return handler(request, service, result.auth);
  };
}
