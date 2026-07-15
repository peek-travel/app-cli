import { describe, it, expect, vi } from 'vitest';

vi.mock('@peektravel/app-utilities/ui/tokens.css', () => ({}));
vi.mock('@peektravel/app-utilities/ui/odyssey.css', () => ({}));
vi.mock('@/lib/odyssey/OdysseyLoader', () => ({ OdysseyLoader: () => null }));

const { default: SettingsViewLayout } = await import('../SettingsViewLayout');

describe('SettingsViewLayout', () => {
  it('renders children inside the layout', () => {
    const result = SettingsViewLayout({ children: 'test-child-content' });
    expect(JSON.stringify(result)).toContain('test-child-content');
  });

  it('renders a non-null layout', () => {
    const result = SettingsViewLayout({ children: null });
    expect(result).not.toBeNull();
  });
});
