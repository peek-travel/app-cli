import { NextResponse } from "next/server";
import { withAppAuthentication } from "@/lib/with-app";

export const GET = withAppAuthentication(async (_request, _service, auth) => {
  return NextResponse.json({ name: auth.user.name });
});
