import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseLcov, rankGaps, toMarkdown, toRanges } from './coverage-gaps.mjs'

const LCOV = `TN:
SF:/repo/backend/src/router.ts
FN:3,list
FN:9,remove
FNDA:1,list
FNDA:0,remove
BRDA:4,0,0,1
BRDA:4,0,1,0
BRDA:10,1,0,-
DA:3,1
DA:4,1
DA:5,0
DA:6,0
DA:9,0
DA:10,0
end_of_record
SF:/repo/backend/src/ok.ts
FN:1,ok
FNDA:2,ok
DA:1,2
end_of_record
`

describe('coverage-gaps', () => {
  it('collapses line numbers into ranges', () => {
    assert.equal(toRanges([9, 3, 4, 5, 12, 10]), '3-5, 9-10, 12')
    assert.equal(toRanges([]), '')
  })

  it('parses lcov into per-file metrics with uncovered locations', () => {
    const [router, ok] = parseLcov(LCOV, { appDir: '/repo/backend' })
    assert.deepEqual(router, {
      file: 'src/router.ts',
      lines: 33.33,
      branches: 33.33,
      functions: 50,
      uncoveredLines: '5-6, 9-10',
      uncoveredBranchLines: '4, 10',
      uncoveredFunctions: ['remove (line 9)'],
    })
    assert.equal(ok.lines, 100)
    assert.equal(ok.branches, 100)
  })

  it('ranks files under the threshold and filters by changed files', () => {
    const report = parseLcov(LCOV, { appDir: '/repo/backend' })
    assert.deepEqual(rankGaps(report, { threshold: 90 }).map((gap) => gap.file), ['src/router.ts'])
    assert.deepEqual(rankGaps(report, { files: ['backend/src/ok.ts'] }).map((gap) => gap.file), ['src/ok.ts'])
  })

  it('renders a markdown table', () => {
    const markdown = toMarkdown('backend', rankGaps(parseLcov(LCOV, { appDir: '/repo/backend' }), { threshold: 90 }))
    assert.match(markdown, /\| `src\/router.ts` \| 33.33% \| 33.33% \| 50% \| 5-6, 9-10 \|/)
    assert.equal(toMarkdown('frontend', []), '**frontend**: no coverage gaps.\n')
  })
})
