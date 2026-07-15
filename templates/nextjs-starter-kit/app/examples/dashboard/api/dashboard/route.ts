import { type NextRequest, NextResponse } from "next/server";
import { ADD_ON_PRODUCT_TYPE, type PeekAccessService } from "@peektravel/app-utilities";
import { withPeekAuthentication } from "@/lib/with-peek";

export const GET = withPeekAuthentication(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    const [products, todayBookings, weekBookings] = await Promise.all([
      peek.getAllProducts(),
      peek.searchBookingsByTimeRange({
        start: todayStart.toISOString(),
        end: tomorrowStart.toISOString(),
        searchBy: "activityDate",
      }),
      peek.searchBookingsByTimeRange({
        start: weekStart.toISOString(),
        end: now.toISOString(),
        searchBy: "purchaseDate",
      }),
    ]);

    const activities = products.filter((p) => p.type !== ADD_ON_PRODUCT_TYPE);
    const activeToday = todayBookings.filter((b) => !b.isCanceled);
    const activeWeek = weekBookings.filter((b) => !b.isCanceled);
    const weekRevenue = activeWeek.reduce(
      (sum, b) => sum + parseFloat(b.valueAmount || "0"),
      0,
    );

    return NextResponse.json({
      activitiesCount: activities.length,
      todayBookings: {
        count: activeToday.length,
        canceledCount: todayBookings.filter((b) => b.isCanceled).length,
      },
      weekBookings: {
        count: activeWeek.length,
        revenue: weekRevenue.toFixed(2),
      },
    });
  },
);
