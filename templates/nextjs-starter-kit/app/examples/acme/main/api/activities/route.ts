import { type NextRequest, NextResponse } from "next/server";
import { type AcmeAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

// This route lives under the ACME tree, so it KNOWS its accessor is an
// AcmeAccessService — name it and skip any runtime narrowing.
export const GET = withAppAuthentication<AcmeAccessService>(
  async (_request: NextRequest, acme: AcmeAccessService) => {
    const products = await acme.getAllActivities();
    const activities = products.map(({ productId, name, color }) => ({
      id: productId,
      name,
      color,
    }));
    return NextResponse.json({ activities });
  },
);
