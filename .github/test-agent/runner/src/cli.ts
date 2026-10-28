import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { APPS } from './tools.ts'

export const SKILLS = [
  'analyze-pr-changes',
  'coverage-gaps',
  'backend-unit-tests',
  'frontend-unit-tests',
  'run-and-verify-tests',
  'report-test-results',
]

// Built-in tools the agent gets. `tools` replaces the whole built-in set, so Skill
// and StructuredOutput (the tool behind outputFormat) must be listed explicitly.
export const BUILT_IN_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill', 'StructuredOutput']

const REQUIRED_TOOLS = [
  ...BUILT_IN_TOOLS,
  'mcp__test-tools__analyze_changes',
  'mcp__test-tools__run_tests',
  'mcp__test-tools__typecheck',
  'mcp__test-tools__coverage',
]

/**
 * Checks the session's init message before the agent spends any budget:
 * a missing tool or skill silently degrades the run instead of failing it.
 */
export function checkSession(init: { tools: string[]; skills?: string[]; mcp_servers: { name: string; status: string }[] }): string[] {
  const problems = REQUIRED_TOOLS.filter((tool) => !init.tools.includes(tool)).map((tool) => `missing tool ${tool}`)
  if (init.skills) problems.push(...SKILLS.filter((skill) => !init.skills!.includes(skill)).map((skill) => `missing skill ${skill}`))
  for (const server of init.mcp_servers.filter((server) => server.status !== 'connected')) {
    problems.push(`MCP server ${server.name} is ${server.status}`)
  }
  return problems
}

/** Skills the agent definition preloads; they reach the agent without a Skill tool call. */
export function readPreloadedSkills(configRoot: string): string[] {
  const definition = readFileSync(path.join(configRoot, '.claude/agents/test-engineer.md'), 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(definition)?.[1] ?? ''
  const list = /^skills:\r?\n((?:[ \t]+-[ \t]+\S+\r?\n?)+)/m.exec(frontmatter)?.[1] ?? ''
  return [...list.matchAll(/-[ \t]+([\w-]+)/g)].map((match) => match[1])
}

const ArgsSchema = z.object({
  mode: z.enum(['pr', 'coverage']),
  repo: z.string().default('.'),
  configRoot: z.string().optional(),
  changes: z.string().optional(),
  out: z.string().default('.test-agent'),
  apps: z
    .string()
    .default(APPS.join(','))
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.enum(APPS)).min(1)),
  model: z.string().default(process.env.TEST_AGENT_MODEL || 'claude-sonnet-5-5'),
  maxTurns: z.coerce.number().int().min(5).max(300).default(80),
  maxBudgetUsd: z.coerce.number().positive().max(50).default(Number(process.env.TEST_AGENT_MAX_BUDGET_USD || 6)),
  timeoutMinutes: z.coerce.number().positive().max(120).default(30),
})

export type RunnerArgs = z.infer<typeof ArgsSchema> & { repo: string; configRoot: string; out: string }

export function parseArgs(argv: string[]): RunnerArgs {
  const raw: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z][a-zA-Z-]*)(?:=(.*))?$/.exec(argv[i])
    if (!match) throw new Error(`Unexpected argument: ${argv[i]}`)
    const key = match[1].replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    raw[key] = match[2] ?? argv[++i]
  }
  const args = ArgsSchema.parse(raw)
  if (args.mode === 'pr' && !args.changes) throw new Error('--changes is required in PR mode')
  const repo = path.resolve(args.repo)
  return {
    ...args,
    repo,
    configRoot: path.resolve(args.configRoot ?? repo),
    changes: args.changes && path.resolve(args.changes),
    out: path.resolve(args.out),
  }
}

interface ChangedFile {
  path: string
  app: string | null
  testable: boolean
  expectedTest?: string
  expectedTestExists?: boolean
  changedSinceLastRun?: boolean
}

/**
 * Builds the task prompt from a trusted template. Only file paths that the
 * detect step has already validated reach the prompt; PR titles, bodies and
 * comments never do.
 */
export function buildPrompt(args: RunnerArgs): string {
  const template = readFileSync(path.join(args.configRoot, '.github/test-agent/prompts', `${args.mode}.md`), 'utf8')
  let files = '(not applicable)'
  if (args.mode === 'pr' && args.changes) {
    const changes = JSON.parse(readFileSync(args.changes, 'utf8')) as { files: ChangedFile[] }
    const testable = changes.files.filter((file) => file.testable && args.apps.includes(file.app as (typeof APPS)[number]))
    files =
      testable
        .map((file) => {
          const test = file.expectedTestExists ? `existing test: ${file.expectedTest}` : `no test yet, conventional path: ${file.expectedTest}`
          const since = file.changedSinceLastRun === false ? ', unchanged since the last agent run' : ''
          return `- ${file.path} (${test}${since})`
        })
        .join('\n') || '(none)'
  }
  return template.replaceAll('{{APPS}}', args.apps.join(', ')).replaceAll('{{FILES}}', files)
}

const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{8,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g]

/** Removes credentials from anything written to artifacts. */
export function redact(text: string, secrets: (string | undefined)[] = [process.env.ANTHROPIC_API_KEY]): string {
  let result = text
  for (const secret of secrets) if (secret && secret.length >= 8) result = result.split(secret).join('[REDACTED]')
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, '[REDACTED]')
  return result
}

/** Environment for the Claude Code process: only what it needs to run and authenticate. */
export function claudeEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'taskly-test-agent/1.0.0',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
  }
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) {
    const value = source[key]
    if (value) env[key] = value
  }
  return env
}
