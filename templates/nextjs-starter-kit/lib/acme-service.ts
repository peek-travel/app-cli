import { AcmeAccessService, type PeekAuthTokenClaims } from "@peektravel/app-utilities";
import { parseEnv } from "@/lib/env";
import { appApiUrl } from "@/lib/peek-service";

/**
 * Build an AcmeAccessService scoped to the install the request authenticated as.
 *
 * The ACME sibling of {@link import("@/lib/cng-service").createCngService}. It
 * talks to the ACME backoffice REST gateway instead of Connect&GO's, but
 * authenticates on the same app JWT (installId + app secret) and routes through
 * the same install `apiUrl`, so the config is identical to the CNG one — no
 * `gatewayKey`/`mode`, ACME adds no fields of its own.
 */
export function createAcmeService(auth: PeekAuthTokenClaims): AcmeAccessService {
  const env = parseEnv();

  return new AcmeAccessService({
    installId: auth.installId,
    jwtSecret: env.PEEK_APP_SECRET,
    issuer: env.PEEK_APP_ID,
    apiUrl: appApiUrl(env),
  });
}
