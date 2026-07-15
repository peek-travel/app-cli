import { type NextRequest, NextResponse } from "next/server";
import { type CngAccessService } from "@peektravel/app-utilities";
import { withCngAuthentication } from "@/lib/with-cng";

export const GET = withCngAuthentication(
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
