import { parseEnv } from '@/lib/env';

/**
 * Peek Pro embeds this app by POSTing the signed peek-auth JWT as a body param
 * to /peek-pro/main. This route handler exists only because `page.tsx`
 * cannot receive POST requests.
 *
 * The posted token is intentionally IGNORED here — we do not authenticate at
 * this step, we just redirect to the GET view. Two reasons:
 *   1. The token cannot be forwarded through a redirect. Cookies are blocked in
 *      third-party iframes, so there is nowhere to carry it to the next request.
 *   2. Verifying here would be redundant. The view is a client-side SPA that
 *      obtains its own token from the parent frame via `postMessage`, and every
 *      data request is authenticated by the API pipeline (see lib/with-peek.ts).
 *      The GET view is openly reachable regardless of what happens here.
 */
function redirectToView() {
  const env = parseEnv();
  const base = env.PEEK_APP_URL.replace(/\/$/, '');
  return Response.redirect(`${base}/peek-pro/main/view`, 302);
}

export const POST = redirectToView;

/**
 * Direct GETs (e.g. navigating here by hand, or a health check) get the same
 * redirect as the POST — there is no separate GET view to render at this
 * exact path, and the real view is openly reachable regardless.
 */
export const GET = redirectToView;
