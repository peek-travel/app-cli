import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { CngPermissionError } from "@peektravel/app-utilities";

vi.mock("@/lib/with-app", () => ({
  withAppAuthentication: (handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest) => handler(request, fakeCng),
}));

const fakeCng = {
  getAllActivities: vi.fn(),
};

const { GET } = await import("../route");

describe("GET /api/activities", () => {
  it("maps productId to id for each activity", async () => {
    fakeCng.getAllActivities.mockResolvedValue([
      { productId: "prod-1", name: "Kayaking", color: "#0f0", type: "ACTIVITY" },
      { productId: "prod-2", name: "Hiking", color: "", type: "ACTIVITY" },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/activities"));
    const body = await response.json();

    expect(body).toEqual({
      activities: [
        { id: "prod-1", name: "Kayaking", color: "#0f0" },
        { id: "prod-2", name: "Hiking", color: "" },
      ],
    });
  });

  it("answers a missing-permission rejection with 403 and the named permissions", async () => {
    fakeCng.getAllActivities.mockRejectedValue(
      new CngPermissionError(["products:read"], { message: "Forbidden" }),
    );

    const response = await GET(new NextRequest("http://localhost/api/activities"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error:
        "CNG request forbidden: the app is missing the required permission: products:read",
      permissions: ["products:read"],
    });
  });

  it("re-throws any other failure", async () => {
    fakeCng.getAllActivities.mockRejectedValue(new Error("boom"));

    await expect(
      GET(new NextRequest("http://localhost/api/activities")),
    ).rejects.toThrow("boom");
  });
});
