import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequestToken = vi.fn();
const mockApiFetch = vi.fn();
vi.mock("@/app/peek-pro/client/api", () => ({
  requestToken: mockRequestToken,
  apiFetch: mockApiFetch,
}));

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

const { default: SettingsViewPage } = await import("../page");

// State order: ready, userName, activities, loadingActivities, error
function makeStates(
  overrides: {
    ready?: boolean;
    userName?: string | null;
    activities?: unknown[] | null;
    loadingActivities?: boolean;
    error?: string | null;
  } = {},
): Array<[unknown, ReturnType<typeof vi.fn>]> {
  const {
    ready = false,
    userName = null,
    activities = null,
    loadingActivities = false,
    error = null,
  } = overrides;
  return [
    [ready, vi.fn()],
    [userName, vi.fn()],
    [activities, vi.fn()],
    [loadingActivities, vi.fn()],
    [error, vi.fn()],
  ];
}

beforeEach(() => {
  stateCallIndex = 0;
  stateSequence = [];
  capturedEffects = [];
  mockRequestToken.mockReset();
  mockRequestToken.mockResolvedValue("tok");
  mockApiFetch.mockReset();
});

describe("SettingsViewPage", () => {
  it("shows the loading gate before the token resolves", () => {
    stateSequence = makeStates({ ready: false });
    expect(JSON.stringify(SettingsViewPage())).toContain("Loading");
  });

  it("requests a token via the shared channel on mount", () => {
    stateSequence = makeStates();
    SettingsViewPage();
    capturedEffects[0]?.();
    expect(mockRequestToken).toHaveBeenCalledTimes(1);
  });

  it("marks ready once the token resolves", async () => {
    const setReady = vi.fn();
    stateSequence = [
      [false, setReady],
      [null, vi.fn()],
      [null, vi.fn()],
      [false, vi.fn()],
      [null, vi.fn()],
    ];
    SettingsViewPage();
    capturedEffects[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(setReady).toHaveBeenCalledWith(true);
  });

  it("stays on the loading gate if the token request rejects", async () => {
    mockRequestToken.mockRejectedValue(new Error("timed out"));
    const setReady = vi.fn();
    stateSequence = [
      [false, setReady],
      [null, vi.fn()],
      [null, vi.fn()],
      [false, vi.fn()],
      [null, vi.fn()],
    ];
    SettingsViewPage();
    capturedEffects[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(setReady).not.toHaveBeenCalled();
  });

  it("fetches the authenticated user's name once ready", async () => {
    stateSequence = makeStates({ ready: true });
    mockApiFetch.mockResolvedValueOnce({ name: "John" });
    SettingsViewPage();
    capturedEffects[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockApiFetch).toHaveBeenCalledWith("/peek-pro/main/api/me");
  });

  it("does not fetch the user's name before ready", () => {
    stateSequence = makeStates({ ready: false });
    SettingsViewPage();
    capturedEffects[1]?.();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("renders the scaffolding copy once ready", () => {
    stateSequence = makeStates({ ready: true });
    const rendered = JSON.stringify(SettingsViewPage());
    expect(rendered).toContain("Your app is ready");
  });

  it("greets the user by name once it is loaded", () => {
    stateSequence = makeStates({ ready: true, userName: "John" });
    const rendered = JSON.stringify(SettingsViewPage());
    expect(rendered).toContain("Hi, ");
    expect(rendered).toContain("John");
  });

  it("does not render a greeting before the name has loaded", () => {
    stateSequence = makeStates({ ready: true, userName: null });
    const rendered = JSON.stringify(SettingsViewPage());
    expect(rendered).not.toContain("Hi,");
  });

  function findByType(
    node: unknown,
    type: string,
  ): { props: Record<string, unknown> } | null {
    if (!node || typeof node !== "object") return null;
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (el.type === type) return el as { props: Record<string, unknown> };
    const children = el.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const found = findByType(child, type);
      if (found) return found;
    }
    return null;
  }

  it("labels the button 'Pull my activities' before anything has loaded", () => {
    stateSequence = makeStates({ ready: true });
    const button = findByType(SettingsViewPage(), "ody-button");
    expect(button?.props.children).toBe("Pull my activities");
  });

  it("labels the button 'Loading…' while the fetch is in flight", () => {
    stateSequence = makeStates({ ready: true, loadingActivities: true });
    const button = findByType(SettingsViewPage(), "ody-button");
    expect(button?.props.children).toBe("Loading…");
  });

  it("pulls activities via the API on button click", async () => {
    const setActivities = vi.fn();
    const setLoadingActivities = vi.fn();
    const setError = vi.fn();
    stateSequence = [
      [true, vi.fn()],
      [null, vi.fn()],
      [null, setActivities],
      [false, setLoadingActivities],
      [null, setError],
    ];
    mockApiFetch.mockResolvedValueOnce({
      activities: [{ id: "a1", name: "Kayaking" }],
    });

    const result = SettingsViewPage();
    const button = findByType(result, "ody-button");
    expect(button).not.toBeNull();

    await (button?.props.onClick as () => Promise<void>)();

    expect(mockApiFetch).toHaveBeenCalledWith("/peek-pro/main/api/activities");
    expect(setActivities).toHaveBeenCalledWith([
      { id: "a1", name: "Kayaking" },
    ]);
    expect(setLoadingActivities).toHaveBeenCalledWith(false);
  });

  it("shows an error alert when the activities fetch fails", () => {
    stateSequence = makeStates({ ready: true, error: "Request failed" });
    const rendered = JSON.stringify(SettingsViewPage());
    expect(rendered).toContain("Request failed");
  });

  it("shows an empty state when there are no activities", () => {
    stateSequence = makeStates({ ready: true, activities: [] });
    const rendered = JSON.stringify(SettingsViewPage());
    expect(rendered).toContain("No activities");
  });

  it("renders activities once loaded", () => {
    stateSequence = makeStates({
      ready: true,
      activities: [{ id: "a1", name: "Kayaking", color: "#0f0" }],
    });
    const rendered = JSON.stringify(SettingsViewPage());
    expect(rendered).toContain("Kayaking");
    expect(rendered).toContain("#0f0");
  });
});
