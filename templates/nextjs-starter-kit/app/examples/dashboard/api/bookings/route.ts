import { type NextRequest, NextResponse } from "next/server";
import { type PeekAccessService } from "@peektravel/app-utilities";
import { withPeekAuthentication } from "@/lib/with-peek";

export const GET = withPeekAuthentication(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    const bookings = await peek.searchBookingsByTimeRange({
      start: weekStart.toISOString(),
      end: now.toISOString(),
      searchBy: "purchaseDate",
    });

    return NextResponse.json({
      bookings: bookings.slice(0, 20).map((b) => ({
        bookingId: b.bookingId,
        displayId: b.displayId,
        customerName: b.customerName,
        productName: b.productName,
        startsAt: b.startsAt,
        purchasedAt: b.purchasedAt,
        totalTickets: b.totalTickets,
        ticketDescription: b.ticketDescription,
        valueDisplay: b.valueDisplay,
        isCanceled: b.isCanceled,
        isCheckedIn: b.isCheckedIn,
        source: b.source,
      })),
    });
  },
);
