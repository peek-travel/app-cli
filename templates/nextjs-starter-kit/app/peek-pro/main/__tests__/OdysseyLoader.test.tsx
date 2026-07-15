import { describe, it, expect, vi } from 'vitest';

vi.mock('@peektravel/app-utilities/ui', () => ({}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('react');
  return { ...actual, useEffect: (fn: () => void) => fn() };
});

const { OdysseyLoader } = await import('../OdysseyLoader');

describe('OdysseyLoader', () => {
  it('renders null', () => {
    expect(OdysseyLoader()).toBeNull();
  });
});
