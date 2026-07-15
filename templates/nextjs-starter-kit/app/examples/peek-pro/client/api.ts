let currentToken = "";

/**
 * A trusted embedder origin, at any subdomain depth or the bare apex:
 *   - peek.com / peek.stack        (foo.peek.com, foo.dev.peek.com, …)
 *   - connectngo.com               (foo.connectngo.com, …)
 *   - connectngo-<env>.com         (env ∈ staging|demo|qa|training)
 *   - acmeticketing.net / .com     (foo.acmeticketing.net, …)
 * Mirrors the frame-ancestors allowlist in next.config.ts.
 */
const PEEK_ORIGIN_RE =
  /^https?:\/\/([a-z0-9-]+\.)*(peek\.(com|stack)|connectngo\.com|connectngo-(staging|demo|qa|training)\.com|acmeticketing\.(net|com))$/i;

export function isPeekOrigin(origin: string): boolean {
  return PEEK_ORIGIN_RE.test(origin);
}

/**
 * The concrete origin of the Peek Pro parent frame, or null if it cannot be
 * determined or is not a trusted Peek origin. Used as the postMessage target so
 * the token request is never broadcast with a "*" wildcard.
 */
function parentPeekOrigin(): string | null {
  // WebKit/Blink expose the embedder chain directly.
  const ancestor = window.location.ancestorOrigins?.[0];
  if (ancestor && isPeekOrigin(ancestor)) return ancestor;

  // Fall back to the referring document's origin.
  try {
    const ref = document.referrer ? new URL(document.referrer).origin : "";
    if (ref && isPeekOrigin(ref)) return ref;
  } catch {
    // Malformed referrer — ignore and fall through.
  }
  return null;
}

/**
 * The single channel for obtaining a peek-auth token from the parent frame.
 *
 * Posts a request to Peek Pro and resolves with the token from its response,
 * caching it for subsequent `apiFetch` calls. Used both for the initial
 * bootstrap gate (see the dashboard layout) and to refresh after a 401 — there
 * is only ever one requester/listener at a time, never a second bootstrap.
 *
 * Both directions are origin-locked: the request is posted only to a verified
 * Peek origin (never "*"), and the response is accepted only if it arrives from
 * a Peek origin.
 */
export function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = parentPeekOrigin();
    if (!target) {
      console.warn("[peek-spa] requestToken — no trusted Peek parent origin");
      reject(new Error("Not embedded in Peek Pro"));
      return;
    }

    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      console.warn("[peek-spa] requestToken — timed out after 5s");
      reject(new Error("Token refresh timed out"));
    }, 5000);

    const handler = (e: MessageEvent) => {
      if (!isPeekOrigin(e.origin)) return;
      if (
        e.data?.type === "peek-token-response" &&
        typeof e.data.token === "string"
      ) {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        currentToken = e.data.token;
        resolve(e.data.token);
      }
    };

    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "peek-iframe-token-refresh" }, target);
  });
}

export async function apiFetch<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "x-peek-auth": `Bearer ${currentToken}` },
  });

  if (res.status === 401) {
    const newToken = await requestToken();
    const retry = await fetch(url, {
      headers: { "x-peek-auth": `Bearer ${newToken}` },
    });
    if (!retry.ok)
      throw new Error("Something went wrong. Please try reloading the page.");
    return retry.json() as Promise<T>;
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new Error((data.error as string) || "Request failed");
  }

  return res.json() as Promise<T>;
}
