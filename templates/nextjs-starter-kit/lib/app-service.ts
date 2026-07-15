import {
  type CngAccessService,
  type PeekAccessService,
  type PeekAuthTokenClaims,
} from "@peektravel/app-utilities";
import { createCngService } from "@/lib/cng-service";
import { createPeekService } from "@/lib/peek-service";

/**
 * Every backoffice accessor a route can be handed. One deployment of this app is
 * embedded into multiple platforms (Peek, Connect&GO, ...), so the accessor type
 * is only known per-request, from the token's platform claim.
 */
export type AppAccessService = PeekAccessService | CngAccessService;

/**
 * TODO: remove once @peektravel/app-utilities ships the `platform` claim (added
 * after 0.3.0). Bridges the type locally so this compiles against the pinned
 * dependency; delete when the package is bumped.
 */
declare module "@peektravel/app-utilities" {
  interface PeekAuthTokenUser {
    /** Which platform embedded the app for this session. */
    platform: "peek" | "cng" | "acme";
  }
}

/**
 * Factory the backoffice accessor that matches the platform the caller
 * authenticated from.
 *
 * Token verification is brand-agnostic — one peek-auth JWT is minted for every
 * platform — so the `platform` claim is the single thing that decides which
 * gateway a request should talk to. Verify once (upstream), branch here.
 */
export function createAppService(auth: PeekAuthTokenClaims): AppAccessService {
  switch (auth.user.platform) {
    case "peek":
      return createPeekService(auth);
    case "cng":
      return createCngService(auth);
    default:
      // acme has no accessor in the library yet; auth-only routes still work,
      // routes that need a service will surface this until one lands.
      throw new Error(`No app service for platform: ${auth.user.platform}`);
  }
}
