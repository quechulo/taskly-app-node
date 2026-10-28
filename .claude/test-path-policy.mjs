// Single source of truth for the files the test agent may create or modify.
// Used by the Agent SDK runner (canUseTool + PreToolUse hook), the Claude Code
// hook for interactive use, and the CI patch gate. Keep it dependency-free.
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

const SEGMENT = '[A-Za-z0-9_][A-Za-z0-9_.-]*'

export const WRITABLE_TEST_PATHS = [
  {
    app: 'backend',
    description: 'backend/tests/**/*.test.ts',
    pattern: new RegExp(`^backend/tests/(?:${SEGMENT}/)*${SEGMENT}\\.test\\.ts$`),
  },
  {
    app: 'backend',
    description: 'backend/tests/**/fixture*.ts (shared test data)',
    pattern: new RegExp(`^backend/tests/(?:${SEGMENT}/)*fixtures?(?:[.-]${SEGMENT})?\\.ts$`),
  },
  {
    app: 'frontend',
    description: 'frontend/src/**/*.test.ts(x)',
    pattern: new RegExp(`^frontend/src/(?:${SEGMENT}/)*${SEGMENT}\\.test\\.tsx?$`),
  },
  {
    app: 'frontend',
    description: 'frontend/src/test/**/*.ts(x) (shared fixtures and helpers)',
    pattern: new RegExp(`^frontend/src/test/(?:${SEGMENT}/)*${SEGMENT}\\.tsx?$`),
  },
]

// Files inside the writable areas that change how every test runs.
export const PROTECTED_PATHS = new Set(['frontend/src/test/setup.ts'])

export const APPS = ['backend', 'frontend']

export function describeWritablePaths() {
  return WRITABLE_TEST_PATHS.map((rule) => rule.description).join(', ')
}

/** Returns the app a repo-relative writable test path belongs to, or null. */
export function writableTestApp(relativePath) {
  if (typeof relativePath !== 'string' || PROTECTED_PATHS.has(relativePath)) return null
  if (relativePath.split('/').some((segment) => segment === '..' || segment === '.')) return null
  return WRITABLE_TEST_PATHS.find((rule) => rule.pattern.test(relativePath))?.app ?? null
}

export function isWritableTestPath(relativePath) {
  return writableTestApp(relativePath) !== null
}

/**
 * Resolves a tool-supplied path against the repository root, following
 * symlinks of the deepest existing ancestor so that a symlinked directory
 * cannot redirect a write outside the allowed area. Returns a repo-relative
 * POSIX path, or null when the target escapes the repository.
 */
export function toRepoPath(repoRoot, filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) return null
  const root = realpathSync(repoRoot)
  const absolute = path.resolve(root, filePath)
  let existing = absolute
  const rest = []
  while (!existsSync(existing)) {
    rest.unshift(path.basename(existing))
    const parent = path.dirname(existing)
    if (parent === existing) return null
    existing = parent
  }
  const resolved = path.join(realpathSync(existing), ...rest)
  const relative = path.relative(root, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}

/**
 * Policy decision for writing `filePath`; `reason` is shown to the model.
 * @param {string} repoRoot
 * @param {string} filePath
 * @returns {{ allowed: true, path: string, app: 'backend' | 'frontend' } | { allowed: false, reason: string }}
 */
export function checkWrite(repoRoot, filePath) {
  const relative = toRepoPath(repoRoot, filePath)
  if (relative === null) {
    return { allowed: false, reason: `Refusing to write outside the repository: ${filePath}` }
  }
  if (!isWritableTestPath(relative)) {
    return {
      allowed: false,
      reason:
        `The test agent may only write unit tests and test fixtures (${describeWritablePaths()}). ` +
        `"${relative}" is not one of them. Never change application source or test configuration; ` +
        'if the source looks wrong, report it as a suspected defect instead.',
    }
  }
  return { allowed: true, path: relative, app: /** @type {'backend' | 'frontend'} */ (writableTestApp(relative)) }
}

/**
 * Policy decision for reading `filePath`; reads are limited to the given roots.
 * @param {string[]} roots
 * @param {string} filePath
 * @returns {{ allowed: true } | { allowed: false, reason: string }}
 */
export function checkRead(roots, filePath) {
  for (const root of roots) {
    if (toRepoPath(root, filePath) !== null || path.resolve(root, filePath) === path.resolve(root)) {
      return { allowed: true }
    }
  }
  return { allowed: false, reason: `Reading outside the repository is not allowed: ${filePath}` }
}
