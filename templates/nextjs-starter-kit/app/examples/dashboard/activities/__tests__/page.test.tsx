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

const { default: ActivitiesPage } = await import("../page");

// State order: activities, loading, error
function makeStates(overrides: {
  activities?: unknown[];
  loading?: boolean;
  error?: string | null;
} = {}): Array<[unknown, ReturnType<typeof vi.fn>]> {
  const { activities = [], loading = false, error = null } = overrides;
  return [
    [activities, vi.fn()],
    [loading, vi.fn()],
    [error, vi.fn()],
  ];
}

beforeEach(() => {
  stateCallIndex = 0;
  stateSequence = [];
  capturedEffects = [];
  mockApiFetch.mockReset();
});

describe("ActivitiesPage", () => {
  it("shows loading spinner when loading", () => {
    stateSequence = makeStates({ loading: true });
    const result = ActivitiesPage();
    expect(JSON.stringify(result)).toContain("ody-loading-spinner");
  });

  it("shows error alert when error is set", () => {
    stateSequence = makeStates({ error: "fetch failed" });
    const result = ActivitiesPage();
    expect(JSON.stringify(result)).toContain("fetch failed");
  });

  it("shows empty state when activities list is empty", () => {
    stateSequence = makeStates({ activities: [] });
    const result = ActivitiesPage();
    expect(JSON.stringify(result)).toContain("No activities");
  });

  it("renders activity with provided color", () => {
    stateSequence = makeStates({ activities: [{ name: "Kayaking", color: "#0f0" }] });
    const result = ActivitiesPage();
    const rendered = JSON.stringify(result);
    expect(rendered).toContain("Kayaking");
    expect(rendered).toContain("#0f0");
  });

  it("renders default bar color when color is absent", () => {
    stateSequence = makeStates({ activities: [{ name: "Hiking" }] });
    const result = ActivitiesPage();
    expect(JSON.stringify(result)).toContain("var(--color-neutral-300)");
  });

  describe("data-load effect", () => {
    it("calls apiFetch for activities endpoint", async () => {
      stateSequence = makeStates({ loading: true });
      mockApiFetch.mockResolvedValue({ activities: [] });
      ActivitiesPage();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockApiFetch).toHaveBeenCalledWith("/peek-pro/main/api/activities");
    });

    it("success path sets activities and clears loading", async () => {
      const setActivities = vi.fn();
      const setLoading = vi.fn();
      stateSequence = [
        [[], setActivities],
        [true, setLoading],
        [null, vi.fn()],
      ];
      const data = { activities: [{ name: "Surf", color: "#00f" }] };
      mockApiFetch.mockResolvedValueOnce(data);
      ActivitiesPage();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setActivities).toHaveBeenCalledWith(data.activities);
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
      ActivitiesPage();
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
      ActivitiesPage();
      capturedEffects[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(setError).toHaveBeenCalledWith("Failed to load");
      expect(setLoading).toHaveBeenCalledWith(false);
    });
  });
});
