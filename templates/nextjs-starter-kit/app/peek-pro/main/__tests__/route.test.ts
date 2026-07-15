import { describe, it, expect, vi } from 'vitest';

const ORIGIN = 'http://localhost:3000';

vi.mock('@/lib/env', () => ({
  parseEnv: () => ({
    PEEK_APP_SECRET: 'test-secret',
    PEEK_APP_ID: 'test-app-id',
    PEEK_APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test' as const,
  }),
}));

// Import after mocking
const { POST, GET } = await import('../route');

describe('POST /peek-pro/main', () => {
  it('redirects to the GET view (token in body is ignored)', () => {
    const res = POST();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/peek-pro/main/view`);
  });

  it('redirects to the GET view regardless of any posted token', () => {
    // The handler takes no request and performs no verification — it always
    // redirects. Auth happens later in the GET pipeline.
    const first = POST();
    const second = POST();
    expect(first.headers.get('location')).toBe(second.headers.get('location'));
  });
});

describe('GET /peek-pro/main', () => {
  it('redirects to the view, same as POST', () => {
    const res = GET();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/peek-pro/main/view`);
  });
});
