import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/with-peek", () => ({
  withPeekAuthentication:
    (handler: (...args: unknown[]) => unknown) => (request: NextRequest) =>
      handler(request, fakePeek, fakeAuth),
}));

const fakePeek = {};
const fakeAuth = {
  installId: "inst-1",
  displayVersion: "1.0.0",
  user: {
    name: "John",
    email: "john@example.com",
    id: "u-1",
    isAdmin: false,
    locale: "en",
  },
};

const { GET } = await import("../route");

describe("GET /api/me", () => {
  it("returns the authenticated user's name", async () => {
    const response = await GET(new NextRequest("http://localhost/api/me"));
    const body = await response.json();

    expect(body).toEqual({ name: "John" });
  });
});
