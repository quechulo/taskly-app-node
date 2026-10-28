#!/usr/bin/env node
// Independently verifies the agent's patch on a fresh checkout. Runs in a job
// without secrets and without write access; nothing the agent claims is trusted.
//
//   node verify.mjs --repo pr --apps backend,frontend --patch tests.patch --changes changes.json --out verify/
//
// Steps per app: coverage before, patch gate, git apply, typecheck, tests,
// tests again in shuffled order, coverage after, prettier check (frontend).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPatch } from './check-patch.mjs'

const APPS = ['backend', 'frontend']
const MINUTE = 60_000

function run(command, args, cwd, timeout = 10 * MINUTE) {
  const env = { CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' }
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ']) if (process.env[key]) env[key] = process.env[key]
  const result = spawnSync(command, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', timedOut: result.error?.code === 'ETIMEDOUT' }
}

const tail = (text, max = 3000) => (text.length > max ? `…${text.slice(-max)}` : text)
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

function vitest(appDir, out, label, extraArgs = []) {
  const report = path.join(out, `${label}.json`)
  const result = run(process.execPath, [path.join(appDir, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile=${report}`, ...extraArgs], appDir)
  const json = readJson(report)
  if (!json) return { success: false, error: tail(`${result.stderr}\n${result.stdout}`.trim() || 'Vitest produced no report.') }
  const failures = (json.testResults ?? []).flatMap((suite) => {
    const failed = (suite.assertionResults ?? []).filter((test) => test.status === 'failed')
    const file = path.relative(appDir, suite.name)
    if (failed.length === 0 && suite.status === 'failed') return [{ file, test: '(suite failed to run)' }]
    return failed.map((test) => ({ file, test: test.fullName ?? test.title }))
  })
  return {
    success: Boolean(json.success) && failures.length === 0,
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: Math.max(json.numFailedTests ?? 0, failures.length),
    failures: failures.slice(0, 20),
  }
}

function coverage(appDir, out, label) {
  const directory = path.join(out, `coverage-${label}`)
  vitest(appDir, out, `${label}-tests`, [
    '--coverage',
    '--coverage.reporter=json-summary',
    `--coverage.reportsDirectory=${directory}`,
    '--coverage.reportOnFailure',
  ])
  return readJson(path.join(directory, 'coverage-summary.json'))
}

const metrics = (entry) => entry && { lines: entry.lines.pct, branches: entry.branches.pct, functions: entry.functions.pct, statements: entry.statements.pct }

/** Before/after coverage for each changed source file and for the app as a whole. */
export function coverageDelta(repo, app, before, after, files) {
  const appFiles = files.filter((file) => file.startsWith(`${app}/`))
  return {
    total: { before: metrics(before?.total), after: metrics(after?.total) },
    files: appFiles.map((file) => {
      const key = path.join(repo, file)
      return { file, before: metrics(before?.[key]), after: metrics(after?.[key]) }
    }),
  }
}

export function overallStatus({ gate, applied, patchEmpty, apps }) {
  if (!gate.ok) return 'rejected'
  if (!applied) return 'failed'
  const allPassed = Object.values(apps).every(
    (app) => app.typecheck?.ok && app.tests?.success && app.testsShuffled?.success && (app.format?.ok ?? true),
  )
  if (!allPassed) return 'failed'
  return patchEmpty ? 'no-changes' : 'passed'
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1]
  return args
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2))
  const repo = realpathSync(path.resolve(args.repo ?? '.'))
  const out = path.resolve(args.out ?? 'verify')
  mkdirSync(out, { recursive: true })
  const patchFile = args.patch && path.resolve(args.patch)
  const patch = patchFile && existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : ''
  const changes = args.changes ? readJson(path.resolve(args.changes)) : null
  const changedSources = (changes?.files ?? []).filter((file) => file.testable).map((file) => file.path)

  const gate = checkPatch(patch)
  const touched = gate.files.map((file) => file.path.split('/')[0])
  const apps = [...new Set([...(args.apps ?? '').split(','), ...touched])].filter((app) => APPS.includes(app))
  const result = { status: 'failed', patch: gate, applied: false, apps: {} }

  const before = Object.fromEntries(apps.map((app) => [app, coverage(path.join(repo, app), out, `${app}-before`)]))

  if (gate.ok && patch.trim()) {
    writeFileSync(path.join(out, 'applied.patch'), patch)
    const check = run('git', ['-C', repo, 'apply', '--check', '--whitespace=nowarn', patchFile], repo)
    if (check.code === 0) result.applied = run('git', ['-C', repo, 'apply', '--whitespace=nowarn', patchFile], repo).code === 0
    else result.applyError = tail(check.stderr)
  } else {
    result.applied = gate.ok
  }

  if (result.applied) {
    for (const app of apps) {
      const appDir = path.join(repo, app)
      const typecheck = run(process.execPath, [path.join(appDir, 'node_modules/typescript/bin/tsc'), '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], appDir)
      const entry = {
        typecheck: { ok: typecheck.code === 0, output: typecheck.code === 0 ? undefined : tail(typecheck.stdout) },
        tests: vitest(appDir, out, `${app}-run1`),
        testsShuffled: vitest(appDir, out, `${app}-run2`, ['--sequence.shuffle']),
      }
      const patchedFiles = gate.files.filter((file) => file.path.startsWith(`${app}/`)).map((file) => file.path.slice(app.length + 1))
      if (app === 'frontend' && patchedFiles.length) {
        const format = run(process.execPath, [path.join(appDir, 'node_modules/prettier/bin/prettier.cjs'), '--check', ...patchedFiles], appDir)
        entry.format = { ok: format.code === 0, output: format.code === 0 ? undefined : tail(`${format.stdout}${format.stderr}`) }
      }
      const after = coverage(appDir, out, `${app}-after`)
      entry.coverage = coverageDelta(repo, app, before[app], after, changedSources)
      result.apps[app] = entry
    }
  }

  result.status = overallStatus({ gate, applied: result.applied, patchEmpty: !patch.trim(), apps: result.apps })
  writeFileSync(path.join(out, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(`Verification ${result.status}: ${apps.map((app) => `${app}=${JSON.stringify({ tc: result.apps[app]?.typecheck?.ok, run1: result.apps[app]?.tests?.success, run2: result.apps[app]?.testsShuffled?.success })}`).join(' ')}`)
}
