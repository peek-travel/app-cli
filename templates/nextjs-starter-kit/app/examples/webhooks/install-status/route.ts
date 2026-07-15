import { type NextRequest, NextResponse } from 'next/server';
import { requirePeekWebhookAuth } from '@/lib/webhook-auth';

/**
 * Peek Pro POSTs install-status webhooks here (install / uninstall / etc.).
 *
 * Auth uses the same registry-signed peek-auth JWT the API pipeline verifies —
 * it arrives in the `x-peek-auth` header — but via `requirePeekWebhookAuth`,
 * which tolerates the `user: null` these system events carry (see
 * lib/webhook-auth.ts). Missing/invalid token => 401.
 *
 * For now this endpoint only logs the delivery to the console; add real
 * handling once the payload shape is confirmed.
 */
type InstallStatusPayload = {
  status?: string;
  install_id?: string;
  display_version?: string;
  account?: { id?: string; name?: string; platform?: string; is_test?: boolean };
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const result = requirePeekWebhookAuth(request);
  if ('error' in result) return result.error;

  const raw = await request.text();
  const body = JSON.parse(raw) as InstallStatusPayload;
  const { status, install_id, display_version, account } = body;
  const test = account?.is_test ? ' [TEST]' : '';

  console.log(`\n📦 [install-status] ${status ?? 'unknown'}${test}`);
  console.log(`   account : ${account?.name ?? '?'} (id ${account?.id ?? '?'}, ${account?.platform ?? '?'})`);
  console.log(`   install : ${install_id ?? '?'}`);
  console.log(`   version : ${display_version ?? '?'}\n`);

  return NextResponse.json({ ok: true });
}
