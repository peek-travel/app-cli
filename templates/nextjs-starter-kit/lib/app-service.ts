import {
  type AcmeAccessService,
  type CngAccessService,
  type PeekAccessService,
  type PeekAuthTokenClaims,
} from "@peektravel/app-utilities";
import { createAcmeService } from "@/lib/acme-service";
import { createCngService } from "@/lib/cng-service";
import { createPeekService } from "@/lib/peek-service";

/**
 * Every backoffice accessor a route can be handed. One deployment of this app is
 * embedded into multiple platforms (Peek, Connect&GO, ACME, ...), so the
 * accessor type is only known per-request, from the token's platform claim.
 */
export type AppAccessService =
  | PeekAccessService
  | CngAccessService
  | AcmeAccessService;

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
    case "acme":
      return createAcmeService(auth);
    default:
      throw new Error(`No app service for platform: ${auth.user.platform}`);
  }
}
