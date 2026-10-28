import { afterEach, expect, it, vi } from 'vitest';

const start = vi.hoisted(() => vi.fn());
vi.mock('../src/core/lifespan.ts', () => ({ start }));

const savedExitCode = process.exitCode;
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  start.mockReset();
  process.exitCode = savedExitCode;
});

it('starts the application', async () => {
  start.mockResolvedValue({});
  await import('../src/main.ts');
  expect(start).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(savedExitCode);
});

it('logs and sets the exit code when startup fails', async () => {
  const error = new Error('fail');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  start.mockRejectedValue(error);
  await import('../src/main.ts');
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(log).toHaveBeenCalledWith('Cannot start Taskly App Node API:', error);
});
