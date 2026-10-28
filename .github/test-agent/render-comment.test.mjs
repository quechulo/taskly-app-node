import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clean, MARKER, renderComment } from './render-comment.mjs'
import { coverageDelta, overallStatus } from './verify.mjs'

const head = 'a'.repeat(40)
const report = {
  status: 'completed',
  model: 'claude-sonnet-5-5',
  agent: {
    summary: 'Covered the stats endpoint.',
    decisions: [{ file: 'backend/src/router.ts', action: 'update', reason: 'New /stats route | 422 path', testFiles: ['backend/tests/router.test.ts'] }],
    suspectedDefects: [{ file: 'backend/src/repository.ts', description: 'Overdue counts completed tasks.', evidence: 'stats() returned 1' }],
    notes: ['Defensive headersSent branch left uncovered.'],
  },
  run: {
    turns: 12,
    durationMs: 61000,
    costUsd: 0.4312,
    skillsUsed: ['analyze-pr-changes', 'backend-unit-tests'],
    skillsPreloaded: ['run-and-verify-tests', 'report-test-results'],
    toolCalls: [{ tool: 'run_tests' }, { tool: 'run_tests' }, { tool: 'typecheck' }],
    permissionDenials: [{ tool: 'Bash', reason: 'not available' }],
  },
}
const verification = {
  status: 'passed',
  patch: { ok: true, violations: [] },
  apps: {
    backend: {
      typecheck: { ok: true },
      tests: { success: true, total: 60, passed: 60, failures: [] },
      testsShuffled: { success: true },
      coverage: {
        total: { before: { lines: 90, branches: 80 }, after: { lines: 95.5, branches: 88 } },
        files: [{ file: 'backend/src/router.ts', before: { lines: 70, branches: 50, functions: 80 }, after: { lines: 100, branches: 100, functions: 100 } }],
      },
    },
  },
}

describe('renderComment', () => {
  it('renders decisions, verification, coverage, defects and run details', () => {
    const body = renderComment({ report, verification, changes: { files: [{ path: 'README.md', testable: false, skipReason: 'Documentation.' }] }, head, runUrl: 'https://example.test/run/1', outcome: 'committed', commit: 'b'.repeat(40) })
    assert.ok(body.startsWith(`${MARKER}\n<!-- test-agent:last-sha=${head} -->`))
    assert.match(body, /committed as `bbbbbbb`/)
    assert.match(body, /\| `backend\/src\/router.ts` \| \*\*update\*\* \| `backend\/tests\/router.test.ts` \| New \/stats route \\\| 422 path \|/)
    assert.match(body, /\| backend \| ✅ \| ✅ 60\/60 \| ✅ \| – \|/)
    assert.match(body, /70% → 100% \(\+30\)/)
    assert.match(body, /\*\*Totals:\*\* backend lines 90% → 95.5% \(\+5.5\), branches 80% → 88% \(\+8\)/)
    assert.match(body, /Suspected defects/)
    assert.match(body, /\*\*cost:\*\* \$0.43/)
    assert.match(body, /run_tests ×2, typecheck ×1/)
    assert.match(body, /Skills used:\*\* `analyze-pr-changes`, `backend-unit-tests` · preloaded: `run-and-verify-tests`, `report-test-results`/)
    assert.match(body, /Blocked tool calls:\*\* 1/)
    assert.match(body, /`README.md`: Documentation./)
    assert.match(body, /\[workflow run\]\(https:\/\/example.test\/run\/1\)/)
  })

  it('explains failures without claiming a commit', () => {
    const failed = { ...verification, status: 'failed', apps: { backend: { ...verification.apps.backend, tests: { success: false, total: 2, passed: 1, failures: [{ file: 'tests/a.test.ts', test: 'a fails' }] } } } }
    const body = renderComment({ report, verification: failed, head, outcome: 'not-committed' })
    assert.match(body, /did not pass independent verification/)
    assert.doesNotMatch(body, /last-sha/)
    assert.match(body, /backend\/tests\/a.test.ts: a fails/)
    assert.doesNotMatch(body, /committed as/)
    assert.match(renderComment({ report, verification: { status: 'rejected', patch: { violations: ['backend/src/x.ts: not a writable test path'] } }, head, outcome: 'not-committed' }), /rejected by the safety gate[\s\S]*not a writable test path/)
    assert.match(renderComment({ report: { status: 'failed', error: 'Agent stopped: error_max_turns' }, head, outcome: 'agent-failed' }), /did not complete.*error_max_turns/)
  })
})

describe('clean', () => {
  it('neutralises HTML, mentions, code spans and table breakers', () => {
    assert.equal(clean('<img src=x onerror=alert(1)> @octocat `x`'), '&lt;img src=x onerror=alert(1)&gt; @​octocat ˋxˋ')
    assert.equal(clean('a | b\nc', 100, { cell: true }), 'a \\| b c')
    assert.equal(clean('x'.repeat(10), 5), 'xxxxx…')
  })
})

describe('verify helpers', () => {
  it('computes coverage before and after for changed files of one app', () => {
    const before = { total: { lines: { pct: 50 }, branches: { pct: 40 }, functions: { pct: 30 }, statements: { pct: 50 } } }
    const after = {
      total: { lines: { pct: 90 }, branches: { pct: 80 }, functions: { pct: 70 }, statements: { pct: 90 } },
      '/repo/backend/src/stats.ts': { lines: { pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, statements: { pct: 100 } },
    }
    assert.deepEqual(coverageDelta('/repo', 'backend', before, after, ['backend/src/stats.ts', 'frontend/src/a.ts']), {
      total: { before: { lines: 50, branches: 40, functions: 30, statements: 50 }, after: { lines: 90, branches: 80, functions: 70, statements: 90 } },
      files: [{ file: 'backend/src/stats.ts', before: undefined, after: { lines: 100, branches: 100, functions: 100, statements: 100 } }],
    })
  })

  it('derives the overall status', () => {
    const ok = { typecheck: { ok: true }, tests: { success: true }, testsShuffled: { success: true } }
    assert.equal(overallStatus({ gate: { ok: false }, applied: false, patchEmpty: false, apps: {} }), 'rejected')
    assert.equal(overallStatus({ gate: { ok: true }, applied: false, patchEmpty: false, apps: {} }), 'failed')
    assert.equal(overallStatus({ gate: { ok: true }, applied: true, patchEmpty: false, apps: { backend: ok } }), 'passed')
    assert.equal(overallStatus({ gate: { ok: true }, applied: true, patchEmpty: true, apps: { backend: ok } }), 'no-changes')
    assert.equal(overallStatus({ gate: { ok: true }, applied: true, patchEmpty: false, apps: { backend: { ...ok, testsShuffled: { success: false } } } }), 'failed')
    assert.equal(overallStatus({ gate: { ok: true }, applied: true, patchEmpty: false, apps: { frontend: { ...ok, format: { ok: false } } } }), 'failed')
  })
})
