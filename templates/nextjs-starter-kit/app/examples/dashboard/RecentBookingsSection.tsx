"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/peek-pro/client/api";
import type { RecentBooking } from "./types";
import { BookingCard } from "./BookingCard";

/**
 * Loads and renders recent bookings. Owns its own data fetch so it can be
 * dropped into any view that needs the list. Pass `limit` to cap how many are
 * shown (e.g. a preview on the overview tab).
 */
export function RecentBookingsSection({ limit }: { limit?: number }) {
  const [bookings, setBookings] = useState<RecentBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch<{ bookings: RecentBooking[] }>(
          "/examples/dashboard/api/bookings",
        );
        setBookings(data.bookings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <ody-loading-spinner />
      </div>
    );
  }

  if (error) {
    return (
      <ody-alert variant="danger" heading="Failed to load">
        {error}
      </ody-alert>
    );
  }

  if (bookings.length === 0) {
    return (
      <ody-empty-state
        variant="no-results"
        label="No recent bookings"
        caption="No bookings purchased in the last 7 days."
      />
    );
  }

  const shown = limit ? bookings.slice(0, limit) : bookings;

  return (
    <div className="flex flex-col gap-2">
      {shown.map((b) => (
        <BookingCard key={b.bookingId} b={b} />
      ))}
    </div>
  );
}
