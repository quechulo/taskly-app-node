import type { CanUseTool, HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { checkRead, checkWrite } from '../../../../.claude/test-path-policy.mjs'

export const MCP_SERVER_NAME = 'test-tools'
const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

export interface PolicyContext {
  /** Checkout the agent works on; the only place it may write. */
  repoRoot: string
  /** Directories the agent may read: the checkout and the trusted agent config. */
  readRoots: string[]
}

export type Decision = { allow: true } | { allow: false; reason: string }

const deny = (reason: string): Decision => ({ allow: false, reason })

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The complete tool policy of the test agent. Anything not listed is denied,
 * so a newly introduced tool is unavailable until it is deliberately added.
 */
export function evaluateToolUse(toolName: string, input: Record<string, unknown>, context: PolicyContext): Decision {
  if (toolName === 'Read') {
    const target = stringField(input, 'file_path')
    if (!target) return deny('Read requires file_path.')
    const decision = checkRead(context.readRoots, target)
    return decision.allowed ? { allow: true } : deny(decision.reason)
  }
  if (toolName === 'Glob' || toolName === 'Grep') {
    const targets = [stringField(input, 'path') ?? context.repoRoot]
    const pattern = stringField(input, 'pattern')
    if (toolName === 'Glob' && pattern && (pattern.startsWith('/') || pattern.split('/').includes('..'))) targets.push(pattern)
    for (const target of targets) {
      const decision = checkRead(context.readRoots, target)
      if (!decision.allowed) return deny(decision.reason)
    }
    return { allow: true }
  }
  if (WRITE_TOOLS.has(toolName)) {
    const target = stringField(input, 'file_path')
    if (!target) return deny(`${toolName} requires file_path.`)
    const decision = checkWrite(context.repoRoot, target)
    return decision.allowed ? { allow: true } : deny(decision.reason)
  }
  // StructuredOutput is how the agent returns its schema-validated report.
  if (toolName === 'Skill' || toolName === 'StructuredOutput' || toolName.startsWith(MCP_PREFIX)) return { allow: true }
  return deny(`${toolName} is not available to the test agent. Use the ${MCP_PREFIX}* tools to run tests.`)
}

export function createCanUseTool(context: PolicyContext, onDeny: (tool: string, reason: string) => void): CanUseTool {
  return async (toolName, input, { mcpServer }) => {
    // Trust is keyed on provenance, never on the tool-name prefix alone.
    if (toolName.startsWith(MCP_PREFIX) && mcpServer && mcpServer.source !== 'sdk') {
      const reason = `MCP server ${mcpServer.name} is not trusted.`
      onDeny(toolName, reason)
      return { behavior: 'deny', message: reason }
    }
    const decision = evaluateToolUse(toolName, input, context)
    if (decision.allow) return { behavior: 'allow', updatedInput: input }
    onDeny(toolName, decision.reason)
    return { behavior: 'deny', message: decision.reason }
  }
}

/**
 * Same policy as a PreToolUse hook. Hooks run before permission rules and
 * modes, so the policy holds even if a setting auto-approves a tool.
 */
export function createGuardHook(context: PolicyContext, onDeny: (tool: string, reason: string) => void): HookCallback {
  return async (hookInput) => {
    if (hookInput.hook_event_name !== 'PreToolUse') return {}
    const { tool_name: toolName, tool_input: toolInput } = hookInput as PreToolUseHookInput
    const input = toolInput && typeof toolInput === 'object' ? (toolInput as Record<string, unknown>) : {}
    const decision = evaluateToolUse(toolName, input, context)
    if (decision.allow) return {}
    onDeny(toolName, decision.reason)
    return {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason },
    }
  }
}
