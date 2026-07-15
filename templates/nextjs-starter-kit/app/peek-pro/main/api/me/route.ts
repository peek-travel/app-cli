import { NextResponse } from "next/server";
import { withPeekAuthentication } from "@/lib/with-peek";

export const GET = withPeekAuthentication(async (_request, _peek, auth) => {
  return NextResponse.json({ name: auth.user.name });
});
