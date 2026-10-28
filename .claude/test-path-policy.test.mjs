import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { checkRead, checkWrite, isWritableTestPath, toRepoPath, writableTestApp } from './test-path-policy.mjs'

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'policy-'))
  mkdirSync(path.join(root, 'backend/src'), { recursive: true })
  mkdirSync(path.join(root, 'backend/tests'), { recursive: true })
  mkdirSync(path.join(root, 'frontend/src/test'), { recursive: true })
  return root
}

describe('isWritableTestPath', () => {
  it('accepts unit tests and fixtures in both apps', () => {
    for (const file of [
      'backend/tests/router.test.ts',
      'backend/tests/nested/config.test.ts',
      'backend/tests/fixture.ts',
      'backend/tests/fixtures.stats.ts',
      'frontend/src/lib/http.test.ts',
      'frontend/src/features/todos/TodosPage.test.tsx',
      'frontend/src/test/queryClientWrapper.tsx',
    ]) {
      assert.equal(isWritableTestPath(file), true, file)
    }
    assert.equal(writableTestApp('backend/tests/router.test.ts'), 'backend')
    assert.equal(writableTestApp('frontend/src/lib/http.test.ts'), 'frontend')
  })

  it('rejects source, configuration, setup and traversal paths', () => {
    for (const file of [
      'backend/src/features/todos/router.ts',
      'backend/src/router.test.ts',
      'backend/vitest.config.ts',
      'backend/package.json',
      'backend/tests/helper.ts',
      'frontend/src/lib/http.ts',
      'frontend/src/test/setup.ts',
      'frontend/vite.config.ts',
      'frontend/src/../vite.config.test.ts',
      'frontend/src/./lib/http.test.ts',
      '.github/workflows/ci.yml',
      '.claude/test-path-policy.mjs',
      'backend/tests/has space.test.ts',
      'backend/tests/.hidden.test.ts',
    ]) {
      assert.equal(isWritableTestPath(file), false, file)
    }
  })
})

describe('checkWrite', () => {
  it('normalizes absolute and relative paths inside the repository', () => {
    const root = makeRepo()
    assert.deepEqual(checkWrite(root, path.join(root, 'backend/tests/new.test.ts')), {
      allowed: true,
      path: 'backend/tests/new.test.ts',
      app: 'backend',
    })
    assert.equal(checkWrite(root, 'frontend/src/a/b/New.test.tsx').allowed, true)
  })

  it('denies source files with an actionable reason', () => {
    const root = makeRepo()
    const decision = checkWrite(root, 'backend/src/factory.ts')
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /suspected defect/)
  })

  it('denies paths that escape the repository', () => {
    const root = makeRepo()
    assert.equal(checkWrite(root, '../outside.test.ts').allowed, false)
    assert.equal(checkWrite(root, '/etc/passwd').allowed, false)
    assert.equal(checkWrite(root, '').allowed, false)
    assert.equal(checkWrite(root, 'backend/tests/a\0.test.ts').allowed, false)
  })

  it('follows symlinks so a test directory cannot point at source', () => {
    const root = makeRepo()
    symlinkSync(path.join(root, 'backend/src'), path.join(root, 'backend/tests/linked'))
    assert.equal(toRepoPath(root, 'backend/tests/linked/x.test.ts'), 'backend/src/x.test.ts')
    assert.equal(checkWrite(root, 'backend/tests/linked/x.test.ts').allowed, false)
  })
})

describe('checkRead', () => {
  it('allows the configured roots and nothing else', () => {
    const root = makeRepo()
    const config = makeRepo()
    assert.equal(checkRead([root], 'backend/src').allowed, true)
    assert.equal(checkRead([root], root).allowed, true)
    assert.equal(checkRead([root, config], path.join(config, 'backend')).allowed, true)
    assert.equal(checkRead([root], '/proc/self/environ').allowed, false)
    assert.equal(checkRead([root], '../secrets').allowed, false)
  })
})
