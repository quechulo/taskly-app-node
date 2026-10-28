import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseLcov, rankGaps } from '../../../../.claude/skills/coverage-gaps/scripts/coverage-gaps.mjs'
import { checkWrite } from '../../../../.claude/test-path-policy.mjs'
import { runCommand, truncate } from './exec.ts'
import { MCP_SERVER_NAME } from './permissions.ts'
import { parseTscOutput, summarizeVitestJson, type TestRunSummary } from './vitest-results.ts'

export const APPS = ['backend', 'frontend'] as const
export type App = (typeof APPS)[number]

export interface ToolContext {
  repoRoot: string
  tmpRoot: string
  /** detect output for PR mode; absent in coverage mode. */
  changesFile?: string
  onCall: (entry: ToolCallRecord) => void
}

export interface ToolCallRecord {
  tool: string
  app?: App
  args: unknown
  ok: boolean
  durationMs: number
  summary: Record<string, unknown>
}

const MINUTE = 60_000
const vitestBin = (appDir: string) => path.join(appDir, 'node_modules/vitest/vitest.mjs')
const tscBin = (appDir: string) => path.join(appDir, 'node_modules/typescript/bin/tsc')

/**
 * Validates agent-supplied test file paths: each must be an existing unit test
 * of the given app. Returns app-relative paths for Vitest.
 */
export function resolveTestFiles(repoRoot: string, app: App, files: string[]): { files: string[] } | { error: string } {
  const resolved: string[] = []
  for (const file of files) {
    const decision = checkWrite(repoRoot, file)
    if (!decision.allowed || decision.app !== app || !/\.test\.tsx?$/.test(decision.path)) {
      return { error: `${file} is not a ${app} test file.` }
    }
    if (!existsSync(path.join(repoRoot, decision.path))) return { error: `${decision.path} does not exist.` }
    resolved.push(decision.path.slice(app.length + 1))
  }
  return { files: resolved }
}

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  isError,
})

export async function runVitest(
  context: ToolContext,
  app: App,
  files: string[],
  extraArgs: string[] = [],
  timeoutMs = 5 * MINUTE,
): Promise<{ summary?: TestRunSummary; error?: string; tmp: string }> {
  const appDir = path.join(context.repoRoot, app)
  const tmp = mkdtempSync(path.join(context.tmpRoot, `${app}-`))
  const output = path.join(tmp, 'vitest.json')
  const result = await runCommand(
    process.execPath,
    [vitestBin(appDir), 'run', '--reporter=json', `--outputFile=${output}`, ...extraArgs, ...files],
    { cwd: appDir, timeoutMs },
  )
  if (result.timedOut) return { error: `Vitest timed out after ${timeoutMs / 1000}s.`, tmp }
  if (!existsSync(output)) return { error: truncate(`${result.stderr}\n${result.stdout}`.trim() || 'Vitest produced no report.'), tmp }
  return { summary: summarizeVitestJson(readFileSync(output, 'utf8'), appDir), tmp }
}

export function createTestToolsServer(context: ToolContext) {
  const record = async (
    name: string,
    app: App | undefined,
    args: unknown,
    run: () => Promise<{ ok: boolean; result: Record<string, unknown> }>,
  ) => {
    const started = Date.now()
    try {
      const { ok, result } = await run()
      context.onCall({ tool: name, app, args, ok, durationMs: Date.now() - started, summary: result })
      return text(result, !ok)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.onCall({ tool: name, app, args, ok: false, durationMs: Date.now() - started, summary: { error: message } })
      return text(`Tool failed: ${message}`, true)
    }
  }

  const appArg = z.enum(APPS).describe('Which application to run in.')

  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
    timeout: 8 * MINUTE,
    alwaysLoad: true,
    tools: [
      tool(
        'analyze_changes',
        'Return the pull request change analysis: every changed file with its classification, whether it is testable, the conventional test path and existing tests that import it. Only available in PR mode.',
        {},
        async () =>
          record('analyze_changes', undefined, {}, async () => {
            if (!context.changesFile) return { ok: false, result: { error: 'Not in PR mode; there is no change analysis.' } }
            return { ok: true, result: JSON.parse(readFileSync(context.changesFile, 'utf8')) }
          }),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'run_tests',
        'Run Vitest for one app and return pass/fail counts plus failure messages. Pass specific test files (repo-relative) to iterate quickly; omit files to run the whole suite. Set shuffle to detect order-dependent tests.',
        {
          app: appArg,
          files: z.array(z.string().max(300)).max(50).optional().describe('Repo-relative test files, e.g. backend/tests/router.test.ts'),
          shuffle: z.boolean().optional(),
        },
        async ({ app, files = [], shuffle }) =>
          record('run_tests', app, { files, shuffle }, async () => {
            const resolved = resolveTestFiles(context.repoRoot, app, files)
            if ('error' in resolved) return { ok: false, result: { error: resolved.error } }
            const run = await runVitest(context, app, resolved.files, shuffle ? ['--sequence.shuffle'] : [])
            rmSync(run.tmp, { recursive: true, force: true })
            if (run.error || !run.summary) return { ok: false, result: { error: run.error } }
            return { ok: run.summary.success, result: { app, ...run.summary } }
          }),
      ),
      tool(
        'typecheck',
        'Type-check one app with tsc --noEmit (tests included). Returns the first errors with file and line.',
        { app: appArg },
        async ({ app }) =>
          record('typecheck', app, {}, async () => {
            const appDir = path.join(context.repoRoot, app)
            const result = await runCommand(process.execPath, [tscBin(appDir), '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], {
              cwd: appDir,
              timeoutMs: 4 * MINUTE,
            })
            const errors = parseTscOutput(result.stdout)
            const ok = result.code === 0
            const extra = !ok && errors.length === 0 ? { output: truncate(`${result.stdout}\n${result.stderr}`) } : {}
            return { ok, result: { app, ok, errorCount: errors.length, errors: errors.slice(0, 30), ...extra } }
          }),
      ),
      tool(
        'coverage',
        'Run the whole suite of one app with coverage and return per-file line/branch/function percentages with uncovered line ranges. Pass repo-relative source files to focus on them; otherwise files below the threshold are listed, worst first.',
        {
          app: appArg,
          files: z.array(z.string().max(300)).max(50).optional().describe('Repo-relative source files, e.g. frontend/src/lib/http.ts'),
          threshold: z.number().min(0).max(100).optional().describe('List files below this percentage (default 100).'),
        },
        async ({ app, files, threshold = 100 }) =>
          record('coverage', app, { files, threshold }, async () => {
            const run = await runVitest(
              context,
              app,
              [],
              ['--coverage', '--coverage.reporter=lcov', '--coverage.reportOnFailure', '--coverage.thresholds.perFile=false'],
              7 * MINUTE,
            )
            const appDir = path.join(context.repoRoot, app)
            const lcovFile = path.join(appDir, 'coverage/lcov.info')
            try {
              if (!existsSync(lcovFile)) return { ok: false, result: { error: run.error ?? 'No coverage report was produced.' } }
              const report = parseLcov(readFileSync(lcovFile, 'utf8'), { appDir })
              const gaps = rankGaps(report, { threshold, files })
              return {
                ok: Boolean(run.summary?.success),
                result: {
                  app,
                  tests: run.summary ? { passed: run.summary.passed, failed: run.summary.failed, failures: run.summary.failures } : run.error,
                  filesBelowThreshold: gaps.length,
                  gaps: gaps.slice(0, 25),
                },
              }
            } finally {
              rmSync(run.tmp, { recursive: true, force: true })
            }
          }),
      ),
    ],
  })
}
