import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { AGENT_TRAILER, detect } from './detect.mjs'

function repoWithHistory() {
  const repo = mkdtempSync(path.join(tmpdir(), 'detect-'))
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  const commit = (files, message) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
      writeFileSync(path.join(repo, file), content)
    }
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q', '-b', 'main')
  const base = commit({ 'backend/src/stats.ts': 'export const a = 1\n', 'README.md': 'x\n' }, 'base')
  return { repo, base, commit }
}

describe('detect', () => {
  it('analyses testable changes and attaches diffs', () => {
    const { repo, base, commit } = repoWithHistory()
    const head = commit({ 'backend/src/stats.ts': 'export const a = 2\n', 'README.md': 'y\n' }, 'feature')
    const result = detect({ repo, base, head })
    assert.equal(result.shouldRun, true)
    assert.equal(result.summary.backend, true)
    assert.equal(result.summary.frontend, false)
    const stats = result.files.find((file) => file.path === 'backend/src/stats.ts')
    assert.match(stats.diff, /-export const a = 1\n\+export const a = 2/)
    assert.equal(result.files.find((file) => file.path === 'README.md').diff, undefined)
  })

  it('skips documentation-only pull requests', () => {
    const { repo, base, commit } = repoWithHistory()
    const head = commit({ 'README.md': 'docs\n' }, 'docs')
    assert.equal(detect({ repo, base, head }).shouldRun, false)
  })

  it('skips commits made by the agent itself', () => {
    const { repo, base, commit } = repoWithHistory()
    const head = commit({ 'backend/src/stats.ts': 'export const a = 3\n' }, `test: add tests\n\n${AGENT_TRAILER}`)
    const result = detect({ repo, base, head })
    assert.equal(result.shouldRun, false)
    assert.match(result.reason, /test agent/)
  })

  it('skips when only non-source files changed since the last processed commit', () => {
    const { repo, base, commit } = repoWithHistory()
    const first = commit({ 'backend/src/stats.ts': 'export const a = 4\n' }, 'feature')
    const head = commit({ 'README.md': 'later\n' }, 'docs')
    assert.equal(detect({ repo, base, head, last: first }).shouldRun, false)
    assert.equal(detect({ repo, base, head: first, last: first }).shouldRun, false)
    const next = commit({ 'backend/src/stats.ts': 'export const a = 5\n' }, 'more')
    assert.equal(detect({ repo, base, head: next, last: first }).shouldRun, true)
  })

  it('ignores a last-processed marker that is not an ancestor of the head', () => {
    const { repo, base, commit } = repoWithHistory()
    const head = commit({ 'backend/src/stats.ts': 'export const a = 6\n' }, 'feature')
    const result = detect({ repo, base, head, last: 'f'.repeat(40) })
    assert.equal(result.shouldRun, true)
    assert.equal(result.lastProcessed, null)
  })

  it('requires full commit SHAs', () => {
    const { repo } = repoWithHistory()
    assert.throws(() => detect({ repo, base: 'main', head: 'HEAD' }), /full commit SHA/)
  })
})
