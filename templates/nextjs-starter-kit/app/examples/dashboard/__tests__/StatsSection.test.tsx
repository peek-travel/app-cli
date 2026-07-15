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

const { StatsSection } = await import("../StatsSection");

// State order: stats, loading, error
function makeStates(overrides: {
  stats?: unknown;
  loading?: boolean;
  error?: string | null;
} = {}): Array<[unknown, ReturnType<typeof vi.fn>]> {
  const { stats = null, loading = false, error = null } = overrides;
  return [
    [stats, vi.fn()],
    [loading, vi.fn()],
    [error, vi.fn()],
  ];
}

const STATS = {
  activitiesCount: 5,
  todayBookings: { count: 3, canceledCount: 1 },
  weekBookings: { count: 10, revenue: "1200.00" },
};

beforeEach(() => {
  stateCallIndex = 0;
  stateSequence = [];
  capturedEffects = [];
  mockApiFetch.mockReset();
});

describe("StatsSection", () => {
  it("shows loading spinner when loading", () => {
    stateSequence = makeStates({ loading: true });
    expect(JSON.stringify(StatsSection())).toContain("ody-loading-spinner");
  });

  it("shows error alert when error is set", () => {
    stateSequence = makeStates({ error: "something failed" });
    expect(JSON.stringify(StatsSection())).toContain("something failed");
  });

  it("renders nothing when there are no stats", () => {
    stateSequence = makeStates({ stats: null });
    expect(StatsSection()).toBeNull();
  });

  it("renders stat summary when stats are loaded", () => {
    stateSequence = makeStates({ stats: STATS });
    const rendered = JSON.stringify(StatsSection());
    expect(rendered).toContain("ody-stat-summary");
    expect(rendered).toContain("1200.00");
  });

  it("renders stat with success tone when today count > 0", () => {
    stateSequence = makeStates({ stats: STATS });
    expect(JSON.stringify(StatsSection())).toContain('"tone":"success"');
  });

  it("renders stat with default tone when today count is 0", () => {
    stateSequence = makeStates({
      stats: { ...STATS, todayBookings: { count: 0, canceledCount: 0 } },
    });
    expect(JSON.stringify(StatsSection())).toContain('"tone":"default"');
  });

  it("shows canceled sub-text when canceledCount > 0", () => {
    stateSequence = makeStates({ stats: STATS });
    expect(JSON.stringify(StatsSection())).toContain("canceled");
  });

  it("shows no canceled sub-text when canceledCount is 0", () => {
    stateSequence = makeStates({
      stats: { ...STATS, todayBookings: { count: 0, canceledCount: 0 } },
    });
    expect(JSON.stringify(StatsSection())).not.toContain(" canceled");
  });

  describe("data-load effect", () => {
    it("calls apiFetch for the dashboard endpoint", async () => {
      stateSequence = makeStates({ loading: true });
      mockApiFetch.mockResolvedValue(STATS);
      StatsSection();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockApiFetch).toHaveBeenCalledWith("/examples/dashboard/api/dashboard");
    });

    it("success path sets stats and clears loading", async () => {
      const setStats = vi.fn();
      const setLoading = vi.fn();
      stateSequence = [
        [null, setStats],
        [true, setLoading],
        [null, vi.fn()],
      ];
      mockApiFetch.mockResolvedValueOnce(STATS);
      StatsSection();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setStats).toHaveBeenCalledWith(STATS);
      expect(setLoading).toHaveBeenCalledWith(false);
    });

    it("error path with Error instance sets error message", async () => {
      const setLoading = vi.fn();
      const setError = vi.fn();
      stateSequence = [
        [null, vi.fn()],
        [true, setLoading],
        [null, setError],
      ];
      mockApiFetch.mockRejectedValue(new Error("Network failure"));
      StatsSection();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setError).toHaveBeenCalledWith("Network failure");
      expect(setLoading).toHaveBeenCalledWith(false);
    });

    it("error path with non-Error sets fallback message", async () => {
      const setLoading = vi.fn();
      const setError = vi.fn();
      stateSequence = [
        [null, vi.fn()],
        [true, setLoading],
        [null, setError],
      ];
      mockApiFetch.mockRejectedValue("plain string");
      StatsSection();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setError).toHaveBeenCalledWith("Failed to load");
      expect(setLoading).toHaveBeenCalledWith(false);
    });
  });
});
