import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/with-app", () => ({
  withAppAuthentication: (handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest) => handler(request, fakeAcme),
}));

const fakeAcme = {
  getAllActivities: vi.fn(),
};

const { GET } = await import("../route");

describe("GET /api/activities", () => {
  it("maps productId to id for each activity", async () => {
    fakeAcme.getAllActivities.mockResolvedValue([
      { productId: "prod-1", name: "Kayaking", color: "#0f0", type: "standard" },
      { productId: "prod-2", name: "Hiking", color: "", type: "standard" },
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
});
