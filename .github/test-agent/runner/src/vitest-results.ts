import { truncate } from './exec.ts'

export interface TestFailure {
  file: string
  test: string
  message: string
}

export interface TestRunSummary {
  success: boolean
  total: number
  passed: number
  failed: number
  skipped: number
  files: number
  failures: TestFailure[]
}

interface VitestJsonReport {
  success?: boolean
  numTotalTests?: number
  numPassedTests?: number
  numFailedTests?: number
  numPendingTests?: number
  numTodoTests?: number
  testResults?: {
    name: string
    status?: string
    message?: string
    assertionResults?: { fullName?: string; title?: string; status: string; failureMessages?: string[] }[]
  }[]
}

const ANSI = new RegExp(String.raw`\u001b\[[0-9;]*m`, 'g')

/** Condenses Vitest's JSON reporter output into what the agent needs to act on. */
export function summarizeVitestJson(raw: string, appDir: string, maxFailures = 15): TestRunSummary {
  const report = JSON.parse(raw) as VitestJsonReport
  const failures: TestFailure[] = []
  for (const suite of report.testResults ?? []) {
    const file = suite.name.startsWith(appDir) ? suite.name.slice(appDir.length + 1) : suite.name
    const failed = (suite.assertionResults ?? []).filter((result) => result.status === 'failed')
    // A suite can fail without failing assertions, e.g. on an import or syntax error.
    if (failed.length === 0 && suite.status === 'failed') {
      failures.push({ file, test: '(suite failed to run)', message: truncate((suite.message ?? '').replace(ANSI, ''), 1500) })
    }
    for (const result of failed) {
      failures.push({
        file,
        test: result.fullName ?? result.title ?? '(unnamed test)',
        message: truncate((result.failureMessages ?? []).join('\n').replace(ANSI, ''), 1500),
      })
    }
  }
  return {
    success: Boolean(report.success) && failures.length === 0,
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: Math.max(report.numFailedTests ?? 0, failures.length),
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    files: report.testResults?.length ?? 0,
    failures: failures.slice(0, maxFailures),
  }
}

export interface TypeError {
  file: string
  line: number
  message: string
}

/** Parses `tsc --pretty false` output: path(line,col): error TS1234: message */
export function parseTscOutput(output: string): TypeError[] {
  const errors: TypeError[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/.exec(line.trim())
    if (match) errors.push({ file: match[1], line: Number(match[2]), message: match[3] })
  }
  return errors
}
