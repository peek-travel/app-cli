import { type NextRequest, NextResponse } from 'next/server';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { parseEnv } from '@/lib/env';

/**
 * Auth for inbound Peek webhooks (e.g. install-status).
 *
 * Peek POSTs the same registry-signed peek-auth JWT the API pipeline uses, in
 * the `x-peek-auth` header. We do NOT reuse the library's
 * `verifyPeekAuthToken` here: that helper assumes a user context and throws on
 * `user: null`, but webhooks are system events with no user. So we verify the
 * delivery ourselves against the same secret and signature scheme — signature,
 * `app_registry_v2` issuer, `Joken` audience, and expiry — tolerant of a null
 * user.
 */
const ISSUER = 'app_registry_v2';
const AUDIENCE = 'Joken';

type WebhookAuthSuccess = { auth: JwtPayload };
type WebhookAuthFailure = { error: NextResponse };

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export function requirePeekWebhookAuth(
  request: NextRequest,
): WebhookAuthSuccess | WebhookAuthFailure {
  const header = request.headers.get('x-peek-auth');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : header ?? null;

  if (!token) return { error: unauthorized() };

  const env = parseEnv();
  try {
    const auth = jwt.verify(token, env.PEEK_APP_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof auth === 'string') return { error: unauthorized() };
    return { auth };
  } catch {
    return { error: unauthorized() };
  }
}
