import { CngAccessService, type PeekAuthTokenClaims } from "@peektravel/app-utilities";
import { parseEnv } from "@/lib/env";

/**
 * Build a CngAccessService scoped to the install the request authenticated as.
 *
 * The CNG sibling of {@link import("@/lib/peek-service").createPeekService}. It
 * talks to the Connect&GO backoffice REST gateway instead of Peek's GraphQL one,
 * but authenticates on the same app JWT (installId + app secret) and routes
 * through the same app-registry base URL, so the config is a subset of the Peek
 * one — no `gatewayKey`/`mode`, CNG adds no fields of its own.
 */
export function createCngService(auth: PeekAuthTokenClaims): CngAccessService {
  const env = parseEnv();

  return new CngAccessService({
    installId: auth.installId,
    jwtSecret: env.PEEK_APP_SECRET,
    issuer: env.PEEK_APP_ID,
    appId: env.PEEK_APP_ID,
    baseUrl: env.PEEK_API_URL,
  });
}
