import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_TOOLS, buildPrompt, checkSession, claudeEnv, parseArgs, readPreloadedSkills, redact, SKILLS } from './cli.ts'
import { AgentReportSchema } from './report.ts'
import { schemaFile, schemaText } from './write-schema.ts'

describe('parseArgs', () => {
  it('parses PR mode with defaults and resolves paths', () => {
    const args = parseArgs(['--mode', 'pr', '--repo=pr', '--config-root', 'trusted', '--changes', 'changes.json', '--apps', 'backend'])
    expect(args).toMatchObject({ mode: 'pr', apps: ['backend'], maxTurns: 80, timeoutMinutes: 30 })
    expect(args.repo).toBe(path.resolve('pr'))
    expect(args.configRoot).toBe(path.resolve('trusted'))
    expect(args.changes).toBe(path.resolve('changes.json'))
  })

  it('defaults the config root to the repository in coverage mode', () => {
    const args = parseArgs(['--mode', 'coverage'])
    expect(args.configRoot).toBe(args.repo)
    expect(args.apps).toEqual(['backend', 'frontend'])
  })

  it('rejects invalid input', () => {
    expect(() => parseArgs(['--mode', 'pr'])).toThrow('--changes is required')
    expect(() => parseArgs(['--mode', 'deploy'])).toThrow()
    expect(() => parseArgs(['--mode', 'coverage', '--apps', 'database'])).toThrow()
    expect(() => parseArgs(['--mode', 'coverage', '--max-turns', '1000'])).toThrow()
    expect(() => parseArgs(['coverage'])).toThrow('Unexpected argument')
  })
})

describe('buildPrompt', () => {
  it('lists only testable files of the selected apps', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'prompt-'))
    mkdirSync(path.join(root, '.github/test-agent/prompts'), { recursive: true })
    writeFileSync(path.join(root, '.github/test-agent/prompts/pr.md'), 'Apps: {{APPS}}\n{{FILES}}')
    const changes = path.join(root, 'changes.json')
    writeFileSync(
      changes,
      JSON.stringify({
        files: [
          { path: 'backend/src/stats.ts', app: 'backend', testable: true, expectedTest: 'backend/tests/stats.test.ts', expectedTestExists: false },
          { path: 'backend/src/router.ts', app: 'backend', testable: true, expectedTest: 'backend/tests/router.test.ts', expectedTestExists: true, changedSinceLastRun: false },
          { path: 'frontend/src/a.ts', app: 'frontend', testable: true, expectedTest: 'frontend/src/a.test.ts' },
          { path: 'README.md', app: null, testable: false },
        ],
      }),
    )
    const prompt = buildPrompt(parseArgs(['--mode', 'pr', '--repo', root, '--changes', changes, '--apps', 'backend']))
    expect(prompt).toBe(
      'Apps: backend\n' +
        '- backend/src/stats.ts (no test yet, conventional path: backend/tests/stats.test.ts)\n' +
        '- backend/src/router.ts (existing test: backend/tests/router.test.ts, unchanged since the last agent run)',
    )
  })
})

describe('checkSession', () => {
  const skills = [...SKILLS, 'deep-research']
  const connected = [{ name: 'test-tools', status: 'connected' }]

  it('accepts a session with every required tool, skill and server', () => {
    const tools = [...BUILT_IN_TOOLS, 'mcp__test-tools__analyze_changes', 'mcp__test-tools__run_tests', 'mcp__test-tools__typecheck', 'mcp__test-tools__coverage']
    expect(checkSession({ tools, skills, mcp_servers: connected })).toEqual([])
  })

  it('flags the first local run, where `tools` dropped Skill and StructuredOutput', () => {
    // Tool list copied from that run's init message.
    const tools = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'mcp__test-tools__analyze_changes', 'mcp__test-tools__run_tests', 'mcp__test-tools__typecheck', 'mcp__test-tools__coverage']
    expect(checkSession({ tools, skills, mcp_servers: connected })).toEqual(['missing tool Skill', 'missing tool StructuredOutput'])
  })

  it('flags missing skills and disconnected servers', () => {
    expect(checkSession({ tools: BUILT_IN_TOOLS, skills: ['coverage-gaps'], mcp_servers: [{ name: 'test-tools', status: 'failed' }] })).toEqual(
      expect.arrayContaining(['missing tool mcp__test-tools__run_tests', 'missing skill backend-unit-tests', 'MCP server test-tools is failed']),
    )
  })
})

describe('readPreloadedSkills', () => {
  it('reads the skills list from the agent frontmatter', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-'))
    mkdirSync(path.join(root, '.claude/agents'), { recursive: true })
    writeFileSync(
      path.join(root, '.claude/agents/test-engineer.md'),
      '---\nname: test-engineer\nskills:\n  - run-and-verify-tests\n  - report-test-results\nhooks:\n  PreToolUse: []\n---\n\nskills:\n  - not-frontmatter\n',
    )
    expect(readPreloadedSkills(root)).toEqual(['run-and-verify-tests', 'report-test-results'])
  })

  it('matches the real agent definition', () => {
    expect(readPreloadedSkills(path.resolve(import.meta.dirname, '../../../..'))).toEqual(['run-and-verify-tests', 'report-test-results'])
  })
})

describe('redact', () => {
  it('removes the configured key and token-shaped strings', () => {
    expect(redact('key=my-secret-value', ['my-secret-value'])).toBe('key=[REDACTED]')
    expect(redact('sk-ant-api03-abcdefghijkl ghp_abcdefghijklmnopqrstuvwxyz0123', [])).toBe('[REDACTED] [REDACTED]')
    expect(redact('nothing here', [undefined, 'short'])).toBe('nothing here')
  })
})

describe('claudeEnv', () => {
  it('passes authentication but not other secrets to Claude Code', () => {
    expect(claudeEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-x', GITHUB_TOKEN: 'ghs_x', AWS_SECRET_ACCESS_KEY: 'x' })).toEqual({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'taskly-test-agent/1.0.0',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
    })
  })
})

describe('agent report', () => {
  const valid = {
    summary: 'Added router tests.',
    decisions: [{ file: 'backend/src/router.ts', action: 'update', reason: 'New stats route.', testFiles: ['backend/tests/router.test.ts'] }],
    suspectedDefects: [],
    notes: [],
  }

  it('accepts a valid report and rejects unknown fields or actions', () => {
    expect(AgentReportSchema.safeParse(valid).success).toBe(true)
    expect(AgentReportSchema.safeParse({ ...valid, testsPassed: true }).success).toBe(false)
    expect(AgentReportSchema.safeParse({ ...valid, decisions: [{ ...valid.decisions[0], action: 'delete' }] }).success).toBe(false)
  })

  it('keeps the schema documented in the report-test-results skill in sync', () => {
    expect(readFileSync(schemaFile, 'utf8')).toBe(schemaText)
  })
})
