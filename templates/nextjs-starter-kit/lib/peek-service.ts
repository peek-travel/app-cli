import { PeekAccessService, type PeekAuthTokenClaims } from "@peektravel/app-utilities";
import { parseEnv } from "@/lib/env";

export function createPeekService(auth: PeekAuthTokenClaims): PeekAccessService {
  const env = parseEnv();

  return new PeekAccessService({
    installId: auth.installId,
    jwtSecret: env.PEEK_APP_SECRET,
    issuer: env.PEEK_APP_ID,
    appId: env.PEEK_APP_ID,
    gatewayKey: env.PEEK_APP_ID,
    baseUrl: env.PEEK_API_URL,
    mode: "v2",
  });
}

/**
 * Verify a peek-auth token and return its claims. Verification is
 * install-agnostic (signature + issuer + expiry), so this constructs an
 * app-scoped service purely to delegate to the library's verifier — the
 * library owns all validation logic. Throws on any invalid token.
 */
export function verifyPeekAuthToken(token: string): PeekAuthTokenClaims {
  const env = parseEnv();

  const peek = new PeekAccessService({
    installId: env.PEEK_APP_ID,
    jwtSecret: env.PEEK_APP_SECRET,
    issuer: env.PEEK_APP_ID,
    appId: env.PEEK_APP_ID,
    mode: "v2",
  });

  return peek.verifyPeekAuthToken(token);
}

