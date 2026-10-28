import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  initialize: vi.fn(),
  createApp: vi.fn(),
  resolveDatabaseUrl: vi.fn(),
}));
vi.mock('../src/core/database.ts', () => ({ createDatabase: mocks.createDatabase, initialize: mocks.initialize }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: mocks.resolveDatabaseUrl }));
vi.mock('../src/factory.ts', () => ({ createApp: mocks.createApp }));

import { start } from '../src/core/lifespan.ts';

function fakeServer() {
  const server = Object.assign(new EventEmitter(), { address: () => ({ port: 1234 }), close: vi.fn() });
  return server;
}

let database: { $connect: ReturnType<typeof vi.fn>; $disconnect: ReturnType<typeof vi.fn> };
let server: ReturnType<typeof fakeServer>;
let listen: ReturnType<typeof vi.fn>;
const savedExitCode = process.exitCode;

beforeEach(() => {
  database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  server = fakeServer();
  listen = vi.fn((_port: number, _host: string, cb: () => void) => { queueMicrotask(cb); return server; });
  mocks.createDatabase.mockReturnValue(database);
  mocks.initialize.mockResolvedValue(undefined);
  mocks.resolveDatabaseUrl.mockReturnValue('postgresql://x');
  mocks.createApp.mockReturnValue({ listen });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  process.exitCode = savedExitCode;
});

describe('start', () => {
  it('connects, initializes and listens on API_PORT', async () => {
    vi.stubEnv('API_PORT', '9000');
    vi.spyOn(process, 'once').mockImplementation(() => process);
    const result = await start();
    expect(mocks.createDatabase).toHaveBeenCalledWith('postgresql://x');
    expect(database.$connect).toHaveBeenCalled();
    expect(mocks.initialize).toHaveBeenCalledWith(database);
    expect(listen).toHaveBeenCalledWith(9000, '0.0.0.0', expect.any(Function));
    expect(result).toEqual({ server, database });
    expect(console.log).toHaveBeenCalledWith('Taskly App Node API listening on port 1234');
  });

  it('defaults to port 8000', async () => {
    vi.stubEnv('API_PORT', '');
    vi.spyOn(process, 'once').mockImplementation(() => process);
    await start();
    expect(listen.mock.calls[0][0]).toBe(8000);
  });

  it('disconnects and rethrows when startup fails', async () => {
    const error = new Error('connect failed');
    database.$connect.mockRejectedValue(error);
    await expect(start()).rejects.toBe(error);
    expect(database.$disconnect).toHaveBeenCalled();
  });

  it('rejects when the listener emits an error', async () => {
    const error = new Error('EADDRINUSE');
    listen.mockImplementation(() => { queueMicrotask(() => server.emit('error', error)); return server; });
    await expect(start()).rejects.toBe(error);
    expect(database.$disconnect).toHaveBeenCalled();
  });

  it('registers shutdown handlers that close the server and disconnect', async () => {
    const once = vi.spyOn(process, 'once').mockImplementation(() => process);
    await start();
    expect(once.mock.calls.map((c) => c[0])).toEqual(['SIGTERM', 'SIGINT']);
    const shutdown = once.mock.calls[0][1] as () => void;
    shutdown();
    expect(server.close).toHaveBeenCalled();
    await (server.close.mock.calls[0][0] as () => Promise<void>)();
    expect(database.$disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('sets exit code when disconnect fails during shutdown', async () => {
    const once = vi.spyOn(process, 'once').mockImplementation(() => process);
    await start();
    database.$disconnect.mockRejectedValue(new Error('boom'));
    (once.mock.calls[0][1] as () => void)();
    await (server.close.mock.calls[0][0] as () => Promise<void>)();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('forces exit after the shutdown timeout', async () => {
    vi.useFakeTimers();
    try {
      const once = vi.spyOn(process, 'once').mockImplementation(() => process);
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      await start();
      (once.mock.calls[0][1] as () => void)();
      vi.advanceTimersByTime(10000);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
