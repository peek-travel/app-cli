import { describe, it, expect } from 'vitest';
import { parseEnv } from '../env';

const VALID = {
  PEEK_APP_SECRET: 'super-secret-key',
  PEEK_APP_ID: 'app-123',
  PEEK_API_URL: 'https://api.example.com',
  PEEK_APP_URL: 'https://app.example.com',
};

describe('parseEnv', () => {
  it('returns parsed values for valid input', () => {
    const env = parseEnv(VALID);
    expect(env.PEEK_APP_SECRET).toBe('super-secret-key');
    expect(env.PEEK_APP_ID).toBe('app-123');
    expect(env.PEEK_API_URL).toBe('https://api.example.com');
    expect(env.PEEK_APP_URL).toBe('https://app.example.com');
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws when PEEK_APP_URL is not a valid URL', () => {
    expect(() => parseEnv({ ...VALID, PEEK_APP_URL: 'not-a-url' })).toThrow(
      'Environment configuration error'
    );
  });

  it('throws when PEEK_API_URL is not a valid URL', () => {
    expect(() => parseEnv({ ...VALID, PEEK_API_URL: 'not-a-url' })).toThrow(
      'Environment configuration error'
    );
  });

  it('defaults PEEK_API_URL when missing', () => {
    const withoutApiUrl = Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== 'PEEK_API_URL'));
    const env = parseEnv(withoutApiUrl);
    expect(env.PEEK_API_URL).toBe('https://app-registry.peeklabs.com/installations-api');
  });

  it('defaults PEEK_API_URL when empty string', () => {
    const env = parseEnv({ ...VALID, PEEK_API_URL: '' });
    expect(env.PEEK_API_URL).toBe('https://app-registry.peeklabs.com/installations-api');
  });

  it('respects NODE_ENV when provided', () => {
    const env = parseEnv({ ...VALID, NODE_ENV: 'production' });
    expect(env.NODE_ENV).toBe('production');
  });

  it('throws when PEEK_APP_SECRET is missing', () => {
    expect(() => parseEnv({ PEEK_APP_ID: 'app-123' })).toThrow(
      'Environment configuration error'
    );
  });

  it('throws when PEEK_APP_ID is missing', () => {
    expect(() => parseEnv({ PEEK_APP_SECRET: 'secret' })).toThrow(
      'Environment configuration error'
    );
  });

  it('throws when PEEK_APP_SECRET is empty string', () => {
    expect(() => parseEnv({ ...VALID, PEEK_APP_SECRET: '' })).toThrow(
      'Environment configuration error'
    );
  });

  it('throws when PEEK_APP_ID is empty string', () => {
    expect(() => parseEnv({ ...VALID, PEEK_APP_ID: '' })).toThrow(
      'Environment configuration error'
    );
  });

  it('throws when both vars are missing', () => {
    expect(() => parseEnv({})).toThrow('Environment configuration error');
  });

  it('throws for invalid NODE_ENV value', () => {
    expect(() => parseEnv({ ...VALID, NODE_ENV: 'staging' })).toThrow(
      'Environment configuration error'
    );
  });
});
