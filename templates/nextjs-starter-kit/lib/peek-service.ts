import { PeekAccessService, type PeekAuthTokenClaims } from "@peektravel/app-utilities";
import { parseEnv, type Env } from "@/lib/env";

/**
 * The install's back-office API endpoint to call. The access service's `apiUrl`
 * is each install's own `api.url` from the install webhook — persist it and pass
 * it per install (see app/examples/webhooks/install-status). This starter has no
 * DB, so it stands in with the app-level `PEEK_API_URL` prefix plus the app slug
 * (`<registry-prefix>/<app-slug>`), the shape the webhook's `api.url` also takes.
 */
export function appApiUrl(env: Env): string {
  return `${env.PEEK_API_URL.replace(/\/+$/, "")}/${env.PEEK_APP_ID}`;
}

export function createPeekService(auth: PeekAuthTokenClaims): PeekAccessService {
  const env = parseEnv();

  return new PeekAccessService({
    installId: auth.installId,
    jwtSecret: env.PEEK_APP_SECRET,
    issuer: env.PEEK_APP_ID,
    apiUrl: appApiUrl(env),
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
    apiUrl: appApiUrl(env),
    mode: "v2",
  });

  return peek.verifyPeekAuthToken(token);
}

