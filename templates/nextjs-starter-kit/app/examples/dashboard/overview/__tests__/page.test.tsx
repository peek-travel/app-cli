import { describe, it, expect } from "vitest";
import { StatsSection } from "../../StatsSection";
import { RecentBookingsSection } from "../../RecentBookingsSection";
import OverviewPage from "../page";

type El = { type: unknown; props: Record<string, unknown> };

describe("OverviewPage", () => {
  it("renders the divider and the Recent Bookings heading", () => {
    const rendered = JSON.stringify(OverviewPage());
    expect(rendered).toContain("ody-divider");
    expect(rendered).toContain("Recent Bookings");
  });

  it("renders StatsSection first, then a RecentBookingsSection limited to 5", () => {
    const el = OverviewPage() as unknown as El;
    const kids = el.props.children as El[];
    expect(kids[0].type).toBe(StatsSection);

    const bookingsBlock = kids[2] as El;
    const inner = bookingsBlock.props.children as El[];
    expect(inner[1].type).toBe(RecentBookingsSection);
    expect(inner[1].props).toEqual({ limit: 5 });
  });
});
