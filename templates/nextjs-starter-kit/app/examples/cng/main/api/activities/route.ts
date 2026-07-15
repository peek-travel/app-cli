import { type NextRequest, NextResponse } from "next/server";
import { type CngAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

// This route lives under the CNG tree, so it KNOWS its accessor is a
// CngAccessService — name it and skip any runtime narrowing.
export const GET = withAppAuthentication<CngAccessService>(
  async (_request: NextRequest, cng: CngAccessService) => {
    const products = await cng.getAllActivities();
    const activities = products.map(({ productId, name, color }) => ({
      id: productId,
      name,
      color,
    }));
    return NextResponse.json({ activities });
  },
);
