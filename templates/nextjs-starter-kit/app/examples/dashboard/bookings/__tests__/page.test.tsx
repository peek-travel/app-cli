import { describe, it, expect } from "vitest";
import { RecentBookingsSection } from "../../RecentBookingsSection";
import BookingsPage from "../page";

type El = { type: unknown; props: Record<string, unknown> };

describe("BookingsPage", () => {
  it("renders the recent-bookings section with no limit", () => {
    const el = BookingsPage() as unknown as El;
    expect(el.type).toBe(RecentBookingsSection);
    expect(el.props).toEqual({});
  });
});
