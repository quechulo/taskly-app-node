import { query, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BUILT_IN_TOOLS, buildPrompt, checkSession, claudeEnv, parseArgs, readPreloadedSkills, redact, SKILLS } from './cli.ts'
import { createCanUseTool, createGuardHook, type PolicyContext } from './permissions.ts'
import { AgentReportSchema, agentReportJsonSchema } from './report.ts'
import { createTestToolsServer, type ToolCallRecord } from './tools.ts'

const args = parseArgs(process.argv.slice(2))
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.')
  process.exit(1)
}
mkdirSync(args.out, { recursive: true })
const tmpRoot = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? args.out, 'tools-'))

const toolCalls: ToolCallRecord[] = []
const denials: { tool: string; reason: string }[] = []
const skillsUsed = new Set<string>()
const onDeny = (tool: string, reason: string) => denials.push({ tool, reason })
const policy: PolicyContext = { repoRoot: args.repo, readRoots: [args.repo, args.configRoot] }

const transcript = createWriteStream(path.join(args.out, 'transcript.jsonl'))
const abortController = new AbortController()
const timeout = setTimeout(() => abortController.abort(), args.timeoutMinutes * 60_000)

function track(message: SDKMessage) {
  if (message.type === 'system' && message.subtype === 'init') {
    const problems = checkSession(message)
    if (problems.length) {
      failure = `Agent session is misconfigured: ${problems.join(', ')}`
      abortController.abort()
    }
    return
  }
  if (message.type !== 'assistant') return
  for (const block of message.message.content) {
    if (block.type === 'tool_use' && block.name === 'Skill') {
      const input = block.input as Record<string, unknown>
      const name = input.skill ?? input.name ?? input.command
      if (typeof name === 'string') skillsUsed.add(name.replace(/^\//, ''))
    }
  }
}

let result: SDKResultMessage | undefined
let failure: string | undefined
try {
  const run = query({
    prompt: buildPrompt(args),
    options: {
      cwd: args.repo,
      // Agent definition, skills and hooks come from the trusted checkout, not the PR.
      projectConfigRoot: args.configRoot === args.repo ? undefined : args.configRoot,
      settingSources: ['project'],
      agent: 'test-engineer',
      skills: SKILLS,
      tools: BUILT_IN_TOOLS,
      disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'Task'],
      mcpServers: {
        'test-tools': createTestToolsServer({
          repoRoot: args.repo,
          tmpRoot,
          changesFile: args.mode === 'pr' ? args.changes : undefined,
          onCall: (entry) => toolCalls.push(entry),
        }),
      },
      strictMcpConfig: true,
      permissionMode: 'default',
      canUseTool: createCanUseTool(policy, onDeny),
      hooks: { PreToolUse: [{ hooks: [createGuardHook(policy, onDeny)] }] },
      model: args.model,
      maxTurns: args.maxTurns,
      maxBudgetUsd: args.maxBudgetUsd,
      outputFormat: { type: 'json_schema', schema: agentReportJsonSchema },
      persistSession: false,
      abortController,
      env: claudeEnv(),
      stderr: (data) => process.stderr.write(redact(data)),
    },
  })
  for await (const message of run) {
    transcript.write(`${redact(JSON.stringify(message))}\n`)
    track(message)
    if (message.type === 'result') result = message
  }
} catch (error) {
  failure ??= abortController.signal.aborted
    ? `Agent timed out after ${args.timeoutMinutes} minutes.`
    : redact(error instanceof Error ? error.message : String(error))
} finally {
  clearTimeout(timeout)
  transcript.end()
  rmSync(tmpRoot, { recursive: true, force: true })
}

const parsed = result?.subtype === 'success' ? AgentReportSchema.safeParse(result.structured_output) : undefined
if (!failure && result?.subtype !== 'success') failure = `Agent stopped: ${result?.subtype ?? 'no result'}`
else if (!failure && result?.subtype === 'success' && result.structured_output === undefined) failure = 'Agent finished without a structured report.'
else if (!failure && !parsed?.success) failure = `Agent report failed validation: ${parsed?.error.message}`

const testRuns = toolCalls.filter((call) => call.tool === 'run_tests' || call.tool === 'coverage')
const report = {
  status: failure ? 'failed' : 'completed',
  error: failure,
  mode: args.mode,
  model: args.model,
  apps: args.apps,
  agent: parsed?.success ? parsed.data : null,
  // The agent's closing text, kept for diagnosis when the structured report is missing.
  finalText: result?.subtype === 'success' ? result.result.slice(0, 4000) : undefined,
  run: {
    turns: result?.num_turns,
    durationMs: result?.duration_ms,
    costUsd: result?.total_cost_usd,
    skillsUsed: [...skillsUsed],
    skillsPreloaded: readPreloadedSkills(args.configRoot),
    toolCalls: toolCalls.map(({ tool, app, ok, durationMs }) => ({ tool, app, ok, durationMs })),
    // Ground truth from the runner, not the agent's own account.
    lastTestRuns: Object.fromEntries(
      args.apps.map((app) => [app, testRuns.filter((call) => call.app === app).at(-1)?.summary ?? null]),
    ),
    permissionDenials: denials,
  },
}
writeFileSync(path.join(args.out, 'report.json'), `${redact(JSON.stringify(report, null, 2))}\n`)
writeFileSync(path.join(args.out, 'tool-calls.json'), `${redact(JSON.stringify(toolCalls, null, 2))}\n`)

console.log(
  `Test agent ${report.status}: ${report.agent?.decisions.length ?? 0} decisions, ` +
    `${toolCalls.length} tool calls, skills: ${report.run.skillsUsed.join(', ') || 'none'} ` +
    `(preloaded: ${report.run.skillsPreloaded.join(', ') || 'none'}), ` +
    `cost: $${(report.run.costUsd ?? 0).toFixed(2)}${failure ? `, error: ${failure}` : ''}`,
)
process.exitCode = failure ? 1 : 0
