#!/usr/bin/env node
// Renders the sticky PR comment (and job summary) from the agent report, the
// independent verification and the change analysis.
//
//   node render-comment.mjs --report report.json --verification verification.json --changes changes.json \
//     --head <sha> --run-url <url> --outcome committed|not-committed|no-changes|agent-failed [--commit <sha>]
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MARKER = '<!-- test-agent-report -->'
export const lastShaMarker = (sha) => `<!-- test-agent:last-sha=${sha} -->`

const ICON = { true: '✅', false: '❌', undefined: '–' }

/**
 * Agent output is untrusted text: neutralise HTML, mentions and table
 * breakers, and cap the length so a comment cannot be used to spam or ping.
 */
export function clean(value, max = 600, { cell = false } = {}) {
  let text = String(value ?? '')
    .replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/`/g, 'ˋ')
  if (cell) text = text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const code = (value) => `\`${clean(value, 200, { cell: true })}\``
const pct = (value) => (typeof value === 'number' ? `${value}%` : '–')
const short = (sha) => (sha ? sha.slice(0, 7) : '')

function change(before, after) {
  if (typeof after !== 'number') return '–'
  if (typeof before !== 'number') return `${pct(after)} (new)`
  const delta = Math.round((after - before) * 100) / 100
  return `${pct(before)} → ${pct(after)}${delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : ''}`
}

function headline({ outcome, verification, report, commit }) {
  switch (outcome) {
    case 'committed':
      return `**✅ Unit tests created/updated and verified**, committed as \`${short(commit)}\` to this branch.`
    case 'no-changes':
      return '**ℹ️ No test changes needed.** The existing tests cover this change and pass.'
    case 'agent-failed':
      return `**❌ The test agent did not complete.** Nothing was committed.${report?.error ? ` Reason: ${clean(report.error, 300)}` : ''}`
    case 'stale':
      return '**⏭️ The branch moved while the agent was running.** Nothing was committed; the run for the newer commit will report.'
    default:
      return verification?.status === 'rejected'
        ? '**⛔ The generated patch was rejected by the safety gate.** Nothing was committed.'
        : '**⚠️ The generated tests did not pass independent verification.** Nothing was committed; the patch is attached to the workflow run for review.'
  }
}

export function renderComment({ report, verification, changes, head, runUrl, outcome, commit }) {
  const agent = report?.agent
  // Only a commit whose tests landed (or needed none) counts as processed; after
  // a failure the next push is analysed in full again.
  const processed = outcome === 'committed' || outcome === 'no-changes'
  const lines = [MARKER, ...(processed ? [lastShaMarker(head)] : []), '## 🧪 Test agent', '', headline({ outcome, verification, report, commit }), '']
  if (agent?.summary) lines.push(...clean(agent.summary, 2000).split('\n').map((line) => `> ${line}`), '')

  if (agent?.decisions?.length) {
    lines.push('### Decisions', '', '| Source file | Action | Test files | Reason |', '| --- | --- | --- | --- |')
    for (const decision of agent.decisions) {
      const tests = decision.testFiles.map(code).join('<br>') || '–'
      lines.push(`| ${code(decision.file)} | **${clean(decision.action, 10)}** | ${tests} | ${clean(decision.reason, 400, { cell: true })} |`)
    }
    lines.push('')
  }

  const apps = Object.entries(verification?.apps ?? {})
  if (apps.length) {
    lines.push('### Verification', '', 'Independent re-run on a clean checkout, in a job without secrets.', '', '| App | Typecheck | Tests | Shuffled re-run | Format |', '| --- | :-: | :-: | :-: | :-: |')
    for (const [app, result] of apps) {
      const tests = result.tests?.total !== undefined ? `${ICON[result.tests.success]} ${result.tests.passed}/${result.tests.total}` : ICON[false]
      lines.push(`| ${app} | ${ICON[result.typecheck?.ok]} | ${tests} | ${ICON[result.testsShuffled?.success]} | ${ICON[result.format?.ok]} |`)
    }
    lines.push('')
    const failures = apps.flatMap(([app, result]) => (result.tests?.failures ?? []).map((failure) => `${app}/${failure.file}: ${failure.test}`))
    if (failures.length) lines.push('<details><summary>Failing tests</summary>', '', ...failures.slice(0, 20).map((failure) => `- ${clean(failure, 300)}`), '', '</details>', '')

    const rows = apps.flatMap(([, result]) => result.coverage?.files ?? [])
    if (rows.length) {
      lines.push('### Coverage of changed files', '', '| File | Lines | Branches | Functions |', '| --- | --- | --- | --- |')
      for (const row of rows) {
        lines.push(`| ${code(row.file)} | ${change(row.before?.lines, row.after?.lines)} | ${change(row.before?.branches, row.after?.branches)} | ${change(row.before?.functions, row.after?.functions)} |`)
      }
      const totals = apps.map(([app, result]) => `${app} lines ${change(result.coverage?.total.before?.lines, result.coverage?.total.after?.lines)}, branches ${change(result.coverage?.total.before?.branches, result.coverage?.total.after?.branches)}`)
      lines.push('', `**Totals:** ${totals.join('; ')}`, '')
    }
  }
  if (verification?.patch?.violations?.length) {
    lines.push('### Safety gate', '', ...verification.patch.violations.slice(0, 20).map((violation) => `- ${clean(violation, 300)}`), '')
  }

  if (agent?.suspectedDefects?.length) {
    lines.push('### ⚠️ Suspected defects (needs a human)', '')
    for (const defect of agent.suspectedDefects) {
      lines.push(`- ${code(defect.file)}: ${clean(defect.description, 500)}`, `  <details><summary>Evidence</summary>\n\n  ${clean(defect.evidence, 1200).replace(/\n/g, '\n  ')}\n\n  </details>`)
    }
    lines.push('')
  }

  const details = []
  if (report?.run) {
    const run = report.run
    const calls = Object.entries(
      (run.toolCalls ?? []).reduce((counts, call) => ({ ...counts, [call.tool]: (counts[call.tool] ?? 0) + 1 }), {}),
    ).map(([tool, count]) => `${tool} ×${count}`)
    details.push(
      `- **Model:** ${clean(report.model, 80)} · **turns:** ${run.turns ?? '–'} · **duration:** ${run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : '–'} · **cost:** ${typeof run.costUsd === 'number' ? `$${run.costUsd.toFixed(2)}` : '–'}`,
      `- **Skills used:** ${run.skillsUsed?.length ? run.skillsUsed.map(code).join(', ') : 'none'}${run.skillsPreloaded?.length ? ` · preloaded: ${run.skillsPreloaded.map(code).join(', ')}` : ''}`,
      `- **Tool calls:** ${calls.join(', ') || 'none'}`,
    )
    if (run.permissionDenials?.length) details.push(`- **Blocked tool calls:** ${run.permissionDenials.length} (${[...new Set(run.permissionDenials.map((denial) => denial.tool))].map(code).join(', ')})`)
  }
  for (const note of agent?.notes ?? []) details.push(`- Note: ${clean(note, 400)}`)
  const skipped = (changes?.files ?? []).filter((file) => !file.testable)
  if (skipped.length) {
    details.push('', '**Not analysed (not unit-testable):**', '')
    for (const file of skipped.slice(0, 30)) details.push(`- ${code(file.path)}: ${clean(file.skipReason, 150)}`)
  }
  if (details.length) lines.push('<details><summary>Agent run details</summary>', '', ...details, '', '</details>', '')

  lines.push(`<sub>Analysed \`${short(head)}\`${runUrl ? ` · [workflow run](${runUrl})` : ''} · label \`skip-test-agent\` disables this check</sub>`)
  return `${lines.join('\n')}\n`
}

function readJson(file) {
  return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1]
  process.stdout.write(
    renderComment({
      report: readJson(args.report),
      verification: readJson(args.verification),
      changes: readJson(args.changes),
      head: args.head,
      runUrl: args['run-url'],
      outcome: args.outcome,
      commit: args.commit,
    }),
  )
}
