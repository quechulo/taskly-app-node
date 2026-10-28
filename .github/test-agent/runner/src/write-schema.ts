// Writes the agent report JSON schema next to the report-test-results skill,
// so the skill documents exactly what the runner enforces.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { agentReportJsonSchema } from './report.ts'

export const schemaFile = fileURLToPath(new URL('../../../../.claude/skills/report-test-results/report.schema.json', import.meta.url))
export const schemaText = `${JSON.stringify(agentReportJsonSchema, null, 2)}\n`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) writeFileSync(schemaFile, schemaText)
