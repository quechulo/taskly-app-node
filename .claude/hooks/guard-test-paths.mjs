#!/usr/bin/env node
// PreToolUse hook for the test-engineer agent: only unit tests and fixtures
// may be written. Fails closed: any error blocks the tool call (exit code 2).
import { readFileSync } from 'node:fs'
import { checkWrite } from '../test-path-policy.mjs'

function block(reason) {
  process.stderr.write(`${reason}\n`)
  process.exit(2)
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const toolInput = input.tool_input ?? {}
  const target = toolInput.file_path ?? toolInput.notebook_path
  if (typeof target !== 'string') block(`Blocked ${input.tool_name}: no file path in the tool input.`)
  const decision = checkWrite(input.cwd, target)
  if (!decision.allowed) block(decision.reason)
  process.exit(0)
} catch (error) {
  block(`Test path guard failed closed: ${error instanceof Error ? error.message : String(error)}`)
}
