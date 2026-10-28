import { z } from 'zod'

const repoPath = z.string().min(1).max(300)

/**
 * What the agent must return as structured output. Test results, skills used
 * and coverage are not part of it: the runner and the verify job record those
 * from what actually happened instead of trusting the agent's account.
 */
export const AgentReportSchema = z
  .object({
    summary: z.string().min(1).max(2000).describe('Two to four sentences on what was tested and why, for the PR comment.'),
    decisions: z
      .array(
        z
          .object({
            file: repoPath.describe('Changed or analysed source file, repo-relative.'),
            action: z.enum(['create', 'update', 'skip']),
            reason: z.string().min(1).max(600).describe('Why: behaviour covered, or why no test is needed.'),
            testFiles: z.array(repoPath).max(10).describe('Test files created or updated for this source file.'),
          })
          .strict(),
      )
      .max(100),
    suspectedDefects: z
      .array(
        z
          .object({
            file: repoPath,
            description: z.string().min(1).max(800),
            evidence: z.string().max(1500).describe('Failing expectation, input and observed result.'),
          })
          .strict(),
      )
      .max(20)
      .describe('Source behaviour that looks wrong. Never encode it in a passing test, never fix the source.'),
    notes: z.array(z.string().max(500)).max(10).describe('Limitations or follow-ups worth a human look.'),
  })
  .strict()

export type AgentReport = z.infer<typeof AgentReportSchema>

export const agentReportJsonSchema = z.toJSONSchema(AgentReportSchema, { target: 'draft-7' }) as Record<string, unknown>
