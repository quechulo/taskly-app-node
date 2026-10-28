import { execFile } from 'node:child_process'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

// Variables test processes may see. Everything else, in particular
// ANTHROPIC_API_KEY and any GitHub token, is withheld from code the agent runs.
const PASSTHROUGH = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TZ', 'SystemRoot']

export function minimalEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { CI: 'true', NODE_ENV: 'test', NO_COLOR: '1', FORCE_COLOR: '0' }
  for (const key of PASSTHROUGH) {
    const value = source[key]
    if (value) env[key] = value
  }
  return env
}

/** Runs a binary without a shell, with a minimal environment and a hard timeout. */
export function runCommand(
  command: string,
  args: string[],
  { cwd, timeoutMs }: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, env: minimalEnv(), timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024, shell: false },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
        resolve({
          code: failure ? (typeof failure.code === 'number' ? failure.code : null) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: Boolean(failure?.killed),
          durationMs: Date.now() - started,
        })
      },
    )
  })
}

/** Keeps the start and end of long output, which is where tools put the useful parts. */
export function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text
  const half = Math.floor((max - 40) / 2)
  return `${text.slice(0, half)}\n… [${text.length - 2 * half} characters omitted] …\n${text.slice(-half)}`
}
