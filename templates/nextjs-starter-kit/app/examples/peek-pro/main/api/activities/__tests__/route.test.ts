import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/with-peek", () => ({
  withPeekAuthentication: (handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest) => handler(request, fakePeek),
}));

const fakePeek = {
  getAllActivities: vi.fn(),
};

const { GET } = await import("../route");

describe("GET /api/activities", () => {
  it("maps productId to id for each activity", async () => {
    fakePeek.getAllActivities.mockResolvedValue([
      { productId: "prod-1", name: "Kayaking", color: "#0f0", type: "activity" },
      { productId: "prod-2", name: "Hiking", color: "", type: "activity" },
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
