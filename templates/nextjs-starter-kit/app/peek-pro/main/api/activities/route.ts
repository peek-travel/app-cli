import { type NextRequest, NextResponse } from "next/server";
import { type PeekAccessService } from "@peektravel/app-utilities";
import { withPeekAuthentication } from "@/lib/with-peek";

export const GET = withPeekAuthentication(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const products = await peek.getAllActivities();
    const activities = products.map(({ productId, name, color }) => ({
      id: productId,
      name,
      color,
    }));
    return NextResponse.json({ activities });
  },
);
