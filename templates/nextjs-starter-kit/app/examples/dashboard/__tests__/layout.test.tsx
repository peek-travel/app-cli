import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequestToken = vi.fn();
vi.mock("@/app/peek-pro/client/api", () => ({
  requestToken: mockRequestToken,
  apiFetch: vi.fn(),
}));

vi.mock("next/link", () => ({ default: vi.fn() }));

vi.mock("@/app/peek-pro/main/OdysseyLoader", () => ({ OdysseyLoader: () => null }));
vi.mock("@peektravel/app-utilities/ui/tokens.css", () => ({}));
vi.mock("@peektravel/app-utilities/ui/odyssey.css", () => ({}));

let mockPathname: string | null = "/examples/dashboard/overview";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

let mockReadyValue = false;
let capturedSetReady: ReturnType<typeof vi.fn> | null = null;
let capturedCleanup: (() => void) | null = null;

vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const setter = vi.fn();
      capturedSetReady = setter;
      return [mockReadyValue ?? initial, setter];
    },
    useEffect: (fn: () => (() => void) | void) => {
      capturedCleanup = (fn() as (() => void) | null) ?? null;
    },
  };
});

const { default: DashboardLayout } = await import("../layout");

beforeEach(() => {
  mockReadyValue = false;
  capturedSetReady = null;
  capturedCleanup = null;
  mockPathname = "/examples/dashboard/overview";
  mockRequestToken.mockReset();
  mockRequestToken.mockResolvedValue("tok");
});

describe("DashboardLayout", () => {
  it("renders loading state when not ready", () => {
    const result = DashboardLayout({ children: null });
    expect(JSON.stringify(result)).toContain("Loading");
  });

  it("requests a token via the shared channel on mount", () => {
    DashboardLayout({ children: null });
    expect(mockRequestToken).toHaveBeenCalledTimes(1);
  });

  it("marks ready once the token resolves", async () => {
    DashboardLayout({ children: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(capturedSetReady).toHaveBeenCalledWith(true);
  });

  it("stays on the loading gate if the token request rejects", async () => {
    mockRequestToken.mockRejectedValue(new Error("timed out"));
    DashboardLayout({ children: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(capturedSetReady).not.toHaveBeenCalled();
  });

  it("cleans up without error", () => {
    DashboardLayout({ children: null });
    expect(() => capturedCleanup?.()).not.toThrow();
  });

  it("does not mark ready after cleanup even if the token resolves late", async () => {
    DashboardLayout({ children: null });
    capturedCleanup?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(capturedSetReady).not.toHaveBeenCalled();
  });

  it("renders main nav and children when ready", () => {
    mockReadyValue = true;
    const result = DashboardLayout({ children: "page-content" });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain("main");
    expect(rendered).toContain("tablist");
    expect(rendered).toContain("page-content");
  });

  it("marks overview tab as active when pathname ends with overview", () => {
    mockPathname = "/examples/dashboard/overview";
    mockReadyValue = true;
    const result = DashboardLayout({ children: null });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain('"aria-selected":true');
    expect(rendered).toContain("tab-item--active");
  });

  it("marks bookings tab as active when pathname ends with bookings", () => {
    mockPathname = "/examples/dashboard/bookings";
    mockReadyValue = true;
    const result = DashboardLayout({ children: null });
    expect(JSON.stringify(result)).toContain('"aria-selected":true');
  });

  it("marks activities tab as active when pathname ends with activities", () => {
    mockPathname = "/examples/dashboard/activities";
    mockReadyValue = true;
    const result = DashboardLayout({ children: null });
    expect(JSON.stringify(result)).toContain('"aria-selected":true');
  });

  it("defaults to overview tab when pathname is null", () => {
    mockPathname = null;
    mockReadyValue = true;
    const result = DashboardLayout({ children: null });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain("Overview");
    expect(rendered).toContain('"aria-selected":true');
  });
});
