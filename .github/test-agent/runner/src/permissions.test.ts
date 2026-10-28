import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCanUseTool, createGuardHook, evaluateToolUse, type PolicyContext } from './permissions.ts'

function context(): PolicyContext {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'repo-'))
  const configRoot = mkdtempSync(path.join(tmpdir(), 'config-'))
  mkdirSync(path.join(repoRoot, 'backend/tests'), { recursive: true })
  return { repoRoot, readRoots: [repoRoot, configRoot] }
}

describe('evaluateToolUse', () => {
  it('allows writing unit tests and denies source, config and outside paths', () => {
    const ctx = context()
    expect(evaluateToolUse('Write', { file_path: 'backend/tests/stats.test.ts' }, ctx)).toEqual({ allow: true })
    expect(evaluateToolUse('Edit', { file_path: path.join(ctx.repoRoot, 'frontend/src/App.test.tsx') }, ctx)).toEqual({ allow: true })
    for (const file_path of ['backend/src/factory.ts', 'frontend/vite.config.ts', 'frontend/src/test/setup.ts', '../x.test.ts', '/tmp/x.test.ts']) {
      expect(evaluateToolUse('Write', { file_path }, ctx)).toMatchObject({ allow: false })
    }
    expect(evaluateToolUse('Write', {}, ctx)).toMatchObject({ allow: false, reason: 'Write requires file_path.' })
  })

  it('limits reads and searches to the checkout and trusted config', () => {
    const ctx = context()
    expect(evaluateToolUse('Read', { file_path: 'backend/src/factory.ts' }, ctx)).toEqual({ allow: true })
    expect(evaluateToolUse('Read', { file_path: path.join(ctx.readRoots[1], '.claude/agents/x.md') }, ctx)).toEqual({ allow: true })
    expect(evaluateToolUse('Read', { file_path: '/proc/self/environ' }, ctx)).toMatchObject({ allow: false })
    expect(evaluateToolUse('Grep', { pattern: 'ANTHROPIC', path: '/etc' }, ctx)).toMatchObject({ allow: false })
    expect(evaluateToolUse('Glob', { pattern: '/home/**/.ssh/*' }, ctx)).toMatchObject({ allow: false })
    expect(evaluateToolUse('Glob', { pattern: '../../**' }, ctx)).toMatchObject({ allow: false })
    expect(evaluateToolUse('Glob', { pattern: 'backend/**/*.ts' }, ctx)).toEqual({ allow: true })
    expect(evaluateToolUse('Grep', { pattern: 'todo' }, ctx)).toEqual({ allow: true })
  })

  it('allows skills and the in-process test tools, and denies everything else', () => {
    const ctx = context()
    expect(evaluateToolUse('Skill', { skill: 'backend-unit-tests' }, ctx)).toEqual({ allow: true })
    expect(evaluateToolUse('StructuredOutput', { summary: 'x' }, ctx)).toEqual({ allow: true })
    expect(evaluateToolUse('mcp__test-tools__run_tests', { app: 'backend' }, ctx)).toEqual({ allow: true })
    for (const tool of ['Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'mcp__other__run', 'SomeFutureTool']) {
      expect(evaluateToolUse(tool, {}, ctx)).toMatchObject({ allow: false })
    }
  })
})

describe('createCanUseTool', () => {
  const options = { signal: new AbortController().signal, toolUseID: 'tool-use-1', requestId: 'request-1' }

  it('returns SDK permission results and reports denials', async () => {
    const onDeny = vi.fn()
    const canUseTool = createCanUseTool(context(), onDeny)
    await expect(canUseTool('Write', { file_path: 'backend/tests/a.test.ts' }, options)).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: 'backend/tests/a.test.ts' },
    })
    await expect(canUseTool('Bash', { command: 'env' }, options)).resolves.toMatchObject({ behavior: 'deny' })
    expect(onDeny).toHaveBeenCalledWith('Bash', expect.stringContaining('not available'))
  })

  it('denies tools with our name prefix that come from a configured MCP server', async () => {
    const canUseTool = createCanUseTool(context(), vi.fn())
    await expect(
      canUseTool('mcp__test-tools__run_tests', {}, { ...options, mcpServer: { name: 'test-tools', source: 'project' } }),
    ).resolves.toMatchObject({ behavior: 'deny' })
    await expect(
      canUseTool('mcp__test-tools__run_tests', {}, { ...options, mcpServer: { name: 'test-tools', source: 'sdk' } }),
    ).resolves.toMatchObject({ behavior: 'allow' })
  })
})

describe('createGuardHook', () => {
  const base = { session_id: 's', transcript_path: 't', cwd: '/', hook_event_name: 'PreToolUse' as const, tool_use_id: 'u' }
  const options = { signal: new AbortController().signal, toolUseID: 'tool-use-1', requestId: 'request-1' }

  it('denies disallowed writes before permission rules are consulted', async () => {
    const onDeny = vi.fn()
    const hook = createGuardHook(context(), onDeny)
    await expect(hook({ ...base, tool_name: 'Edit', tool_input: { file_path: 'backend/src/factory.ts' } }, 'u', options)).resolves.toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    })
    await expect(hook({ ...base, tool_name: 'Edit', tool_input: { file_path: 'backend/tests/a.test.ts' } }, 'u', options)).resolves.toEqual({})
    await expect(hook({ ...base, tool_name: 'Write', tool_input: null }, 'u', options)).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    })
    expect(onDeny).toHaveBeenCalledTimes(2)
  })
})
