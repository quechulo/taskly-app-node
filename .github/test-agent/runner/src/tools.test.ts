import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { minimalEnv, runCommand, truncate } from './exec.ts'
import { resolveTestFiles } from './tools.ts'
import { parseTscOutput, summarizeVitestJson } from './vitest-results.ts'

describe('minimalEnv', () => {
  it('never passes credentials to processes the agent starts', () => {
    const env = minimalEnv({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      GITHUB_TOKEN: 'ghs_secret',
      ACTIONS_RUNTIME_TOKEN: 'secret',
      NPM_TOKEN: 'secret',
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/runner', CI: 'true', NODE_ENV: 'test', NO_COLOR: '1', FORCE_COLOR: '0' })
  })

  it('applies to spawned commands', async () => {
    process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test-only'
    const result = await runCommand(process.execPath, ['-e', 'console.log(JSON.stringify(Object.keys(process.env)))'], {
      cwd: tmpdir(),
      timeoutMs: 10_000,
    })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).not.toContain('ANTHROPIC_API_KEY')
  })

  it('reports timeouts', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { cwd: tmpdir(), timeoutMs: 200 })
    expect(result.timedOut).toBe(true)
  })
})

describe('truncate', () => {
  it('keeps both ends of long output', () => {
    const value = truncate(`start${'x'.repeat(10_000)}end`, 200)
    expect(value.length).toBeLessThan(260)
    expect(value.startsWith('start')).toBe(true)
    expect(value.endsWith('end')).toBe(true)
    expect(truncate('short')).toBe('short')
  })
})

describe('resolveTestFiles', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'tools-'))
  mkdirSync(path.join(repo, 'backend/tests'), { recursive: true })
  mkdirSync(path.join(repo, 'frontend/src/lib'), { recursive: true })
  writeFileSync(path.join(repo, 'backend/tests/router.test.ts'), '')
  writeFileSync(path.join(repo, 'backend/tests/fixture.ts'), '')
  writeFileSync(path.join(repo, 'frontend/src/lib/http.test.ts'), '')

  it('returns app-relative paths for existing test files', () => {
    expect(resolveTestFiles(repo, 'backend', ['backend/tests/router.test.ts'])).toEqual({ files: ['tests/router.test.ts'] })
    expect(resolveTestFiles(repo, 'frontend', [path.join(repo, 'frontend/src/lib/http.test.ts')])).toEqual({
      files: ['src/lib/http.test.ts'],
    })
  })

  it('rejects other apps, fixtures, missing files and arguments that look like flags', () => {
    expect(resolveTestFiles(repo, 'frontend', ['backend/tests/router.test.ts'])).toHaveProperty('error')
    expect(resolveTestFiles(repo, 'backend', ['backend/tests/fixture.ts'])).toHaveProperty('error')
    expect(resolveTestFiles(repo, 'backend', ['backend/tests/missing.test.ts'])).toHaveProperty('error')
    expect(resolveTestFiles(repo, 'backend', ['--config=/tmp/evil.ts'])).toHaveProperty('error')
    expect(resolveTestFiles(repo, 'backend', ['backend/src/factory.ts'])).toHaveProperty('error')
  })
})

describe('summarizeVitestJson', () => {
  const appDir = '/repo/frontend'

  it('summarizes passing runs', () => {
    const raw = JSON.stringify({
      success: true,
      numTotalTests: 3,
      numPassedTests: 3,
      numFailedTests: 0,
      testResults: [{ name: '/repo/frontend/src/a.test.ts', status: 'passed', assertionResults: [] }],
    })
    expect(summarizeVitestJson(raw, appDir)).toEqual({ success: true, total: 3, passed: 3, failed: 0, skipped: 0, files: 1, failures: [] })
  })

  it('reports failing assertions and suites that fail to load, without ANSI codes', () => {
    const raw = JSON.stringify({
      success: false,
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      testResults: [
        {
          name: '/repo/frontend/src/a.test.ts',
          status: 'failed',
          assertionResults: [{ fullName: 'a works', status: 'failed', failureMessages: ['\u001b[31mexpected 1 to be 2\u001b[39m'] }],
        },
        { name: '/repo/frontend/src/b.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [] },
      ],
    })
    expect(summarizeVitestJson(raw, appDir)).toMatchObject({
      success: false,
      failed: 2,
      failures: [
        { file: 'src/a.test.ts', test: 'a works', message: 'expected 1 to be 2' },
        { file: 'src/b.test.ts', test: '(suite failed to run)', message: 'SyntaxError: Unexpected token' },
      ],
    })
  })
})

describe('parseTscOutput', () => {
  it('extracts file, line and message', () => {
    const output = "tests/a.test.ts(4,7): error TS2322: Type 'string' is not assignable to type 'number'.\nnoise"
    expect(parseTscOutput(output)).toEqual([
      { file: 'tests/a.test.ts', line: 4, message: "TS2322: Type 'string' is not assignable to type 'number'." },
    ])
  })
})
