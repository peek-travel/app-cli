import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();
vi.mock("@/app/peek-pro/client/api", () => ({ apiFetch: mockApiFetch }));

let stateSequence: Array<[unknown, ReturnType<typeof vi.fn>]> = [];
let stateCallIndex = 0;
let capturedEffects: Array<() => (() => void) | void> = [];

vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const entry = stateSequence[stateCallIndex++];
      return entry ?? [initial, vi.fn()];
    },
    useEffect: (fn: () => (() => void) | void) => {
      capturedEffects.push(fn);
    },
  };
});

const { RecentBookingsSection } = await import("../RecentBookingsSection");

// State order: bookings, loading, error
function makeStates(overrides: {
  bookings?: unknown[];
  loading?: boolean;
  error?: string | null;
} = {}): Array<[unknown, ReturnType<typeof vi.fn>]> {
  const { bookings = [], loading = false, error = null } = overrides;
  return [
    [bookings, vi.fn()],
    [loading, vi.fn()],
    [error, vi.fn()],
  ];
}

const BOOKING = {
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

beforeEach(() => {
  stateCallIndex = 0;
  stateSequence = [];
  capturedEffects = [];
  mockApiFetch.mockReset();
});

describe("RecentBookingsSection", () => {
  it("shows loading spinner when loading", () => {
    stateSequence = makeStates({ loading: true });
    expect(JSON.stringify(RecentBookingsSection({}))).toContain(
      "ody-loading-spinner",
    );
  });

  it("shows error alert when error is set", () => {
    stateSequence = makeStates({ error: "network error" });
    expect(JSON.stringify(RecentBookingsSection({}))).toContain("network error");
  });

  it("renders empty state when no bookings", () => {
    stateSequence = makeStates({ bookings: [] });
    expect(JSON.stringify(RecentBookingsSection({}))).toContain(
      "No recent bookings",
    );
  });

  it("renders bookings when present", () => {
    stateSequence = makeStates({ bookings: [BOOKING] });
    const rendered = JSON.stringify(RecentBookingsSection({}));
    expect(rendered).toContain("Alice");
    expect(rendered).toContain("$100");
  });

  it("shows all bookings when no limit is given", () => {
    const bookings = Array.from({ length: 6 }, (_, i) => ({
      ...BOOKING,
      bookingId: `b-${i}`,
      customerName: `Customer${i}`,
    }));
    stateSequence = makeStates({ bookings });
    const rendered = JSON.stringify(RecentBookingsSection({}));
    expect(rendered).toContain("Customer5");
  });

  it("slices bookings to the given limit", () => {
    const bookings = Array.from({ length: 6 }, (_, i) => ({
      ...BOOKING,
      bookingId: `b-${i}`,
      customerName: `Customer${i}`,
    }));
    stateSequence = makeStates({ bookings });
    const rendered = JSON.stringify(RecentBookingsSection({ limit: 5 }));
    expect(rendered).toContain("Customer4");
    expect(rendered).not.toContain("Customer5");
  });

  it("passes a canceled booking to BookingCard", () => {
    stateSequence = makeStates({ bookings: [{ ...BOOKING, isCanceled: true }] });
    expect(JSON.stringify(RecentBookingsSection({}))).toContain(
      '"isCanceled":true',
    );
  });

  it("passes a checked-in booking to BookingCard", () => {
    stateSequence = makeStates({ bookings: [{ ...BOOKING, isCheckedIn: true }] });
    expect(JSON.stringify(RecentBookingsSection({}))).toContain(
      '"isCheckedIn":true',
    );
  });

  it("passes null customerName to BookingCard", () => {
    stateSequence = makeStates({ bookings: [{ ...BOOKING, customerName: null }] });
    expect(JSON.stringify(RecentBookingsSection({}))).toContain(
      '"customerName":null',
    );
  });

  describe("data-load effect", () => {
    it("calls apiFetch for the bookings endpoint", async () => {
      stateSequence = makeStates({ loading: true });
      mockApiFetch.mockResolvedValue({ bookings: [] });
      RecentBookingsSection({});
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockApiFetch).toHaveBeenCalledWith("/examples/dashboard/api/bookings");
    });

    it("success path sets bookings and clears loading", async () => {
      const setBookings = vi.fn();
      const setLoading = vi.fn();
      stateSequence = [
        [[], setBookings],
        [true, setLoading],
        [null, vi.fn()],
      ];
      const data = { bookings: [BOOKING] };
      mockApiFetch.mockResolvedValueOnce(data);
      RecentBookingsSection({});
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setBookings).toHaveBeenCalledWith(data.bookings);
      expect(setLoading).toHaveBeenCalledWith(false);
    });

    it("error path with Error instance sets error message", async () => {
      const setLoading = vi.fn();
      const setError = vi.fn();
      stateSequence = [
        [[], vi.fn()],
        [true, setLoading],
        [null, setError],
      ];
      mockApiFetch.mockRejectedValue(new Error("Timeout"));
      RecentBookingsSection({});
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setError).toHaveBeenCalledWith("Timeout");
      expect(setLoading).toHaveBeenCalledWith(false);
    });

    it("error path with non-Error sets fallback message", async () => {
      const setLoading = vi.fn();
      const setError = vi.fn();
      stateSequence = [
        [[], vi.fn()],
        [true, setLoading],
        [null, setError],
      ];
      mockApiFetch.mockRejectedValue("plain string");
      RecentBookingsSection({});
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setError).toHaveBeenCalledWith("Failed to load");
      expect(setLoading).toHaveBeenCalledWith(false);
    });
  });
});
