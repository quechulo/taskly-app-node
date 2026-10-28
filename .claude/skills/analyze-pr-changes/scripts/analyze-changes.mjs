#!/usr/bin/env node
// Classifies the files changed between two git revisions and maps every
// testable source file to its conventional unit-test file.
//
//   node analyze-changes.mjs --repo . --base origin/main --head HEAD [--since <sha>]
//
// Classification mirrors the coverage include/exclude lists in
// backend/vitest.config.ts and frontend/vite.config.ts, so "testable" means
// exactly "counted by coverage".
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Paths are interpolated into prompts and PR comments, so anything unusual is
// reported as unsafe instead of being passed through.
const SAFE_PATH = /^[A-Za-z0-9_@.][A-Za-z0-9_@./-]{0,200}$/

const RULES = [
  // backend
  [/^backend\/src\/generated\//, 'generated'],
  [/^backend\/src\/(?:.+\/)?types\.ts$/, 'types'],
  [/^backend\/src\/.+\.ts$/, 'source'],
  [/^backend\/tests\/.+\.test\.ts$/, 'test'],
  [/^backend\/tests\//, 'test-support'],
  [/^backend\//, 'config'],
  // frontend
  [/^frontend\/src\/.+\.test\.tsx?$/, 'test'],
  [/^frontend\/src\/test\//, 'test-support'],
  [/^frontend\/src\/design-system\//, 'design-system'],
  [/^frontend\/src\/.+\.stories\.tsx?$/, 'story'],
  [/^frontend\/src\/(?:.+\/)?(?:types|[^/]+\.types)\.ts$/, 'types'],
  [/^frontend\/src\/(?:.+\/)?index\.ts$/, 'barrel'],
  [/^frontend\/src\/(?:.+\/)?(?:constants\.tsx?|[^/]+\.constants\.ts)$/, 'constants'],
  [/^frontend\/src\/(?:main\.tsx|lib\/queryClient\.ts|features\/todos\/api\/queryKeys\.ts)$/, 'excluded'],
  [/^frontend\/src\/.+\.tsx?$/, 'source'],
  [/^frontend\/src\/.+\.css$/, 'style'],
  [/^frontend\//, 'config'],
  // everything else
  [/\.(?:md|txt)$/i, 'docs'],
  [/^\.github\/|^\.claude\//, 'automation'],
]

const SKIP_REASONS = {
  generated: 'Generated Prisma client; not hand-written code.',
  types: 'Type declarations only; checked by the compiler, no runtime behaviour.',
  test: 'Already a test file.',
  'test-support': 'Test fixture or setup file.',
  config: 'Configuration, schema or tooling file; outside unit-test scope.',
  'design-system': 'Design-system components are excluded from coverage and covered by Storybook.',
  story: 'Storybook story.',
  barrel: 'Re-export barrel without logic.',
  constants: 'Constants are excluded from coverage.',
  excluded: 'Excluded from coverage in vite.config.ts (entry point or static configuration).',
  style: 'Stylesheet.',
  docs: 'Documentation.',
  automation: 'CI or agent configuration; covered by its own tests.',
  other: 'Not part of the frontend or backend application.',
  unsafe: 'Unusual file name; skipped for safety.',
  deleted: 'File was deleted.',
}

export function classify(filePath) {
  if (!SAFE_PATH.test(filePath) || filePath.includes('..')) return 'unsafe'
  return RULES.find(([pattern]) => pattern.test(filePath))?.[1] ?? 'other'
}

export function appOf(filePath) {
  if (filePath.startsWith('backend/')) return 'backend'
  if (filePath.startsWith('frontend/')) return 'frontend'
  return null
}

/** Conventional test location: backend/tests/<name>.test.ts or a colocated *.test.ts(x). */
export function expectedTestPath(filePath) {
  const app = appOf(filePath)
  const ext = path.posix.extname(filePath)
  const name = path.posix.basename(filePath, ext)
  if (app === 'backend') return `backend/tests/${name}.test.ts`
  if (app === 'frontend') return `${path.posix.dirname(filePath)}/${name}.test${ext}`
  return null
}

function listTests(repo, app) {
  const roots = { backend: 'backend/tests', frontend: 'frontend/src' }
  const found = []
  const walk = (dir) => {
    const absolute = path.join(repo, dir)
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (/\.test\.tsx?$/.test(entry.name)) found.push(child)
    }
  }
  walk(roots[app])
  return found
}

const SPECIFIER = /(?:from\s+|import\s*\(\s*|vi\.mock\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

/**
 * Existing tests that import or vi.mock the module, e.g. tests that mock a
 * changed hook. Relative specifiers are resolved, so `./features/todos` (a
 * barrel) does not match `features/todos/utils/todos.ts`.
 */
export function findRelatedTests(repo, filePath, testFiles) {
  const target = filePath.replace(/\.[jt]sx?$/, '')
  return testFiles.filter((test) => {
    const source = readFileSync(path.join(repo, test), 'utf8')
    return [...source.matchAll(SPECIFIER)].some(([, specifier]) => {
      const resolved = path.posix.join(path.posix.dirname(test), specifier).replace(/\.[jt]sx?$/, '')
      return resolved === target
    })
  })
}

/**
 * @param {{ path: string, status: string }[]} changes  git name-status entries
 * @param {{ repo: string, since?: string[] }} options   `since` lists files changed after the last agent run
 */
export function analyzeChanges(changes, { repo, since } = {}) {
  const testsByApp = {}
  const files = changes.map(({ path: filePath, status }) => {
    const kind = status === 'D' ? 'deleted' : classify(filePath)
    const app = appOf(filePath)
    const entry = { path: SAFE_PATH.test(filePath) ? filePath : '<unsafe path>', status, app, kind, testable: kind === 'source' }
    if (since) entry.changedSinceLastRun = since.includes(filePath)
    if (!entry.testable) return { ...entry, skipReason: SKIP_REASONS[kind] ?? SKIP_REASONS.other }
    const expectedTest = expectedTestPath(filePath)
    testsByApp[app] ??= repo ? listTests(repo, app) : []
    return {
      ...entry,
      expectedTest,
      expectedTestExists: repo ? existsSync(path.join(repo, expectedTest)) : false,
      relatedTests: repo ? findRelatedTests(repo, filePath, testsByApp[app]) : [],
    }
  })
  const testable = files.filter((file) => file.testable)
  const pending = since ? testable.filter((file) => file.changedSinceLastRun) : testable
  return {
    files,
    summary: {
      changed: files.length,
      testable: testable.length,
      backend: testable.some((file) => file.app === 'backend'),
      frontend: testable.some((file) => file.app === 'frontend'),
      testsChanged: files.filter((file) => file.kind === 'test').map((file) => file.path),
    },
    shouldRun: pending.length > 0,
    reason: testable.length === 0
      ? 'No testable frontend or backend source files changed.'
      : pending.length === 0
        ? 'No testable source changed since the last agent run.'
        : `${pending.length} testable source file(s) changed.`,
  }
}

export function parseNameStatus(output) {
  // -z output: STATUS\0path\0 or Rxxx\0old\0new\0
  const parts = output.split('\0').filter(Boolean)
  const changes = []
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i]
    if (/^[RC]/.test(status)) {
      changes.push({ status: status[0], path: parts[i + 2], previousPath: parts[i + 1] })
      i += 2
    } else {
      changes.push({ status: status[0], path: parts[i + 1] })
      i += 1
    }
  }
  return changes
}

export function gitChanges(repo, base, head) {
  const output = execFileSync('git', ['-C', repo, 'diff', '--name-status', '-z', '-M', `${base}...${head}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return parseNameStatus(output)
}

/** Adds the (capped) unified diff of each testable file; the agent has no git access. */
export function attachDiffs(result, repo, base, head, maxLines = 250) {
  for (const file of result.files) {
    if (!file.testable) continue
    const diff = execFileSync('git', ['-C', repo, 'diff', '--unified=3', `${base}...${head}`, '--', file.path], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    const lines = diff.split('\n')
    file.diff = lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n… diff truncated (${lines.length} lines)` : diff
  }
  return result
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1]
  return args
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2))
  const repo = path.resolve(args.repo ?? '.')
  const base = args.base ?? 'origin/main'
  const head = args.head ?? 'HEAD'
  const since = args.since ? gitChanges(repo, args.since, head).map((change) => change.path) : undefined
  const result = attachDiffs({ base, head, ...analyzeChanges(gitChanges(repo, base, head), { repo, since }) }, repo, base, head)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
