"use client";
import type { RecentBooking } from "./types";

export function BookingCard({ b }: { b: RecentBooking }) {
  const barColor = b.isCanceled
    ? "var(--color-danger-300)"
    : b.isCheckedIn
      ? "var(--color-success-300)"
      : "var(--color-neutral-300)";

  return (
    <ody-card bar-color={barColor}>
      <div className="p-2 flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium truncate">
            {b.customerName ?? "Guest"}
          </span>
          <span className="text-xs text-gray-500 truncate">
            {b.productName}
          </span>
          <span className="text-xs text-gray-400">
            {b.ticketDescription}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-sm font-semibold">{b.valueDisplay}</span>
          <span className="text-xs text-gray-400">{b.displayId}</span>
          {b.isCanceled && (
            <ody-tag color="danger" size="small">Canceled</ody-tag>
          )}
          {b.isCheckedIn && !b.isCanceled && (
            <ody-tag color="success" size="small">Checked in</ody-tag>
          )}
        </div>
      </div>
    </ody-card>
  );
}
