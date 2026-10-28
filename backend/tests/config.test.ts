import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

function stubParts() {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('POSTGRES_USER', 'us er');
  vi.stubEnv('POSTGRES_PASSWORD', 'p@ss');
  vi.stubEnv('POSTGRES_HOST', 'db.local');
  vi.stubEnv('DB_PORT', '5433');
  vi.stubEnv('POSTGRES_DB', 'my db');
}

describe('resolveDatabaseUrl', () => {
  it('prefers the override and normalises the driver prefix', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://env/db');
    expect(resolveDatabaseUrl('postgresql+psycopg://a:b@h:1/d')).toBe('postgresql://a:b@h:1/d');
  });

  it('uses DATABASE_URL when no override is given', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql+psycopg://env/db');
    expect(resolveDatabaseUrl()).toBe('postgresql://env/db');
  });

  it('builds the URL from parts with encoding', () => {
    stubParts();
    const url = new URL(resolveDatabaseUrl());
    expect(url.protocol).toBe('postgresql:');
    expect(decodeURIComponent(url.username)).toBe('us er');
    expect(decodeURIComponent(url.password)).toBe('p@ss');
    expect(url.hostname).toBe('db.local');
    expect(url.port).toBe('5433');
    expect(url.pathname).toBe('/my%20db');
  });

  it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'])('names missing %s', (name) => {
    stubParts();
    vi.stubEnv(name, '');
    expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
  });
});
