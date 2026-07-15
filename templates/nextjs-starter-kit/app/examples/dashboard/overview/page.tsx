"use client";
import { StatsSection } from "../StatsSection";
import { RecentBookingsSection } from "../RecentBookingsSection";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <StatsSection />

      <ody-divider />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Recent Bookings</span>
        <RecentBookingsSection limit={5} />
      </div>
    </div>
  );
}
