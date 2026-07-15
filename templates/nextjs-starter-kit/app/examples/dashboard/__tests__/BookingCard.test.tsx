import { describe, it, expect } from "vitest";
import { BookingCard } from "../BookingCard";

const BASE = {
  bookingId: "b-1",
  displayId: "#001",
  customerName: "Alice",
  productName: "Kayaking",
  startsAt: null,
  purchasedAt: null,
  totalTickets: 2,
  ticketDescription: "2 adults",
  valueDisplay: "$100",
  isCanceled: false,
  isCheckedIn: false,
  source: "web",
};

describe("BookingCard", () => {
  it("renders neutral bar for a normal booking", () => {
    const result = BookingCard({ b: BASE });
    expect(JSON.stringify(result)).toContain("color-neutral-300");
  });

  it("renders danger bar for a canceled booking", () => {
    const result = BookingCard({ b: { ...BASE, isCanceled: true } });
    expect(JSON.stringify(result)).toContain("color-danger-300");
  });

  it("renders Canceled tag for a canceled booking", () => {
    const result = BookingCard({ b: { ...BASE, isCanceled: true } });
    expect(JSON.stringify(result)).toContain("Canceled");
  });

  it("renders success bar for a checked-in booking", () => {
    const result = BookingCard({ b: { ...BASE, isCheckedIn: true } });
    expect(JSON.stringify(result)).toContain("color-success-300");
  });

  it("renders Checked in tag for a checked-in booking", () => {
    const result = BookingCard({ b: { ...BASE, isCheckedIn: true } });
    expect(JSON.stringify(result)).toContain("Checked in");
  });

  it("renders danger bar (not success) when both canceled and checked-in", () => {
    const result = BookingCard({ b: { ...BASE, isCanceled: true, isCheckedIn: true } });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain("color-danger-300");
    expect(rendered).toContain("Canceled");
    expect(rendered).not.toContain("Checked in");
  });

  it("renders Guest when customerName is null", () => {
    const result = BookingCard({ b: { ...BASE, customerName: null } });
    expect(JSON.stringify(result)).toContain("Guest");
  });

  it("renders customer name when present", () => {
    const result = BookingCard({ b: BASE });
    expect(JSON.stringify(result)).toContain("Alice");
  });

  it("renders value and displayId", () => {
    const result = BookingCard({ b: BASE });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain("$100");
    expect(rendered).toContain("#001");
  });
});
