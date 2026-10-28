import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const hook = fileURLToPath(new URL('./guard-test-paths.mjs', import.meta.url))
const repo = fileURLToPath(new URL('../..', import.meta.url))

function runHook(input) {
  return spawnSync(process.execPath, [hook], { input, encoding: 'utf8' })
}

const payload = (toolInput) => JSON.stringify({ tool_name: 'Write', cwd: repo, tool_input: toolInput })

it('allows unit tests', () => {
  assert.equal(runHook(payload({ file_path: 'backend/tests/x.test.ts' })).status, 0)
})

it('blocks source files and paths outside the repository with exit code 2', () => {
  for (const file_path of ['backend/src/factory.ts', '/etc/passwd', 'frontend/src/test/setup.ts']) {
    const result = runHook(payload({ file_path }))
    assert.equal(result.status, 2, file_path)
    assert.notEqual(result.stderr, '')
  }
})

it('fails closed on malformed input', () => {
  assert.equal(runHook('not json').status, 2)
  assert.equal(runHook(payload({})).status, 2)
})
