import { type NextRequest, NextResponse } from 'next/server';
import { parseInstallWebhook, type InstallWebhook } from '@peektravel/app-utilities';
import { parseEnv } from '@/lib/env';

/**
 * Peek's app registry POSTs install-lifecycle webhooks here
 * (installed / uninstalled / update_installed).
 *
 * The delivery carries two payloads at once: a signed `app_registry_v2` JWT
 * (the security boundary, in the `x-peek-auth` header) and a plain JSON body
 * (enrichment). `parseInstallWebhook(token, body, secret)` verifies the token —
 * signature, `app_registry_v2` issuer, `Joken` audience, expiry — and merges
 * both into one flat `InstallWebhook`, throwing on any verification failure. So
 * a bad/forged delivery is a single try/catch => 401, and we no longer hand-roll
 * JWT verification.
 *
 * The verified token is authoritative for `installId`, `accountId`, `status`,
 * `displayVersion`, and `user`; the unsigned body supplies only `accountName`,
 * `platform`, and `isTest`. This is the ONLY place the app learns who an install
 * belongs to — no back-office read returns the account id. A real app persists
 * the identity here: key account-permanent data on the permanent `accountId`,
 * mint an `installDataId` for wipe-on-reinstall, and store `platform` (it selects
 * the access service) and `accountName`. These fields are never null, so model
 * them as non-nullable columns. For now this endpoint only logs the delivery.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const header = request.headers.get('x-peek-auth');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : header ?? '';
  const body = await request.text();

  let event: InstallWebhook;
  try {
    event = parseInstallWebhook(token, body, parseEnv().PEEK_APP_SECRET);
  } catch {
    // Signature / issuer / audience / expiry failed — the delivery is not from Peek.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const test = event.isTest ? ' [TEST]' : '';
  console.log(`\n📦 [install-status] ${event.rawStatus || 'unknown'}${test}`);
  console.log(`   account : ${event.accountName} (id ${event.accountId}, ${event.platform ?? '?'})`);
  console.log(`   install : ${event.installId}`);
  console.log(`   version : ${event.displayVersion || '?'}\n`);

  switch (event.status) {
    case 'installed':
    case 'update_installed':
      // TODO: upsert the install/account record (accountId, accountName,
      // platform) and stamp a fresh installDataId.
      break;
    case 'uninstalled':
      // TODO: tear down / wipe this install's data.
      break;
    default:
      // Unknown status => fail loud so Peek redelivers. It treats any 2xx as
      // delivered and never retries, so quietly no-op'ing a status this package
      // version doesn't recognize would drop a lifecycle transition forever.
      console.error(`[install-status] unrecognized status: ${event.rawStatus}`);
      return NextResponse.json({ error: `unknown status: ${event.rawStatus}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
