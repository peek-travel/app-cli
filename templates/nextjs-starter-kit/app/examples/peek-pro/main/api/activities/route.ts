import { type NextRequest, NextResponse } from "next/server";
import { type PeekAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

// This route lives under the Peek tree, so it KNOWS its accessor is a
// PeekAccessService — name it and skip any runtime narrowing.
export const GET = withAppAuthentication<PeekAccessService>(
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
