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
 * The JSON body is the source of the event data; the verified token authenticates
 * the whole delivery and backs up the fields it also carries (`installId`,
 * `accountId`, `status`, `displayVersion`, `user`). This is the ONLY place the
 * app learns who an install belongs to AND where to call it — no back-office read
 * returns the account id or the endpoint. A real app persists the identity here:
 * key account-permanent data on the permanent `accountId`, mint an `installDataId`
 * for wipe-on-reinstall, and store `platform` (selects the access service),
 * `accountName`, `timezone`, and — importantly — `apiUrl`, this install's own
 * back-office endpoint. It should build the install's client against that stored
 * `apiUrl` (not a hardcoded URL), and because every event is a full snapshot,
 * upsert by `installId` and overwrite `apiUrl` each time (an `update_installed`
 * can move it). This starter has no DB, so it just logs — and its per-request
 * client still uses the app-level `PEEK_API_URL` (see lib/peek-service.ts) until
 * you persist installs and pass each install's `apiUrl`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // `parseInstallWebhook` strips a leading `Bearer ` for you, so pass the header as-is.
  const token = request.headers.get('x-peek-auth') ?? '';
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
  console.log(`   account : ${event.accountName} (id ${event.accountId}, ${event.platform ?? '?'}, ${event.timezone || '?'})`);
  console.log(`   install : ${event.installId}`);
  console.log(`   apiUrl  : ${event.apiUrl || '?'}`); // persist + call this per install (not a hardcoded endpoint)
  console.log(`   version : ${event.displayVersion || '?'}\n`);

  switch (event.status) {
    case 'installed':
    case 'update_installed':
      // TODO: upsert by event.installId (accountId, accountName, platform,
      // timezone, apiUrl — always the latest) and stamp a fresh installDataId.
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
