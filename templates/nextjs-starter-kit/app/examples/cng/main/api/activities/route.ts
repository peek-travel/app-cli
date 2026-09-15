import { type NextRequest, NextResponse } from "next/server";
import {
  CngPermissionError,
  type CngAccessService,
} from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

// This route lives under the CNG tree, so it KNOWS its accessor is a
// CngAccessService — name it and skip any runtime narrowing.
export const GET = withAppAuthentication<CngAccessService>(
  async (_request: NextRequest, cng: CngAccessService) => {
    try {
      const products = await cng.getAllActivities();
      const activities = products.map(({ productId, name, color }) => ({
        id: productId,
        name,
        color,
      }));
      return NextResponse.json({ activities });
    } catch (err) {
      // A CngPermissionError is an EXPECTED outcome for an install whose
      // manifest grants fewer permissions than this route calls for, so shape it
      // for the UI rather than letting Next.js report a 500 with a stack trace.
      // This lives here, not in withAppAuthentication: that wrapper serves every
      // platform, and only CNG throws this. The transport already logged it at
      // warn — don't re-log. `permissions` lets the client name what to grant.
      if (err instanceof CngPermissionError) {
        return NextResponse.json(
          { error: err.message, permissions: err.permissions },
          { status: err.statusCode },
        );
      }
      throw err;
    }
  },
);
