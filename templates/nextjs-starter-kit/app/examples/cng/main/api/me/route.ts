import { NextResponse } from "next/server";
import { withCngAuthentication } from "@/lib/with-cng";

export const GET = withCngAuthentication(async (_request, _cng, auth) => {
  return NextResponse.json({ name: auth.user.name });
});
