#!/usr/bin/env node
// Decides whether the test agent should run for a pull request and writes the
// change analysis it works from.
//
//   node detect.mjs --repo pr --base <sha> --head <sha> [--last <sha>] --out changes.json
//
// Writes should_run/backend/frontend/reason to $GITHUB_OUTPUT when set.
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeChanges, attachDiffs, gitChanges } from '../../.claude/skills/analyze-pr-changes/scripts/analyze-changes.mjs'

export const AGENT_TRAILER = 'Test-Agent: generated'
const SHA = /^[0-9a-f]{40}$/

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })

function isAncestor(repo, ancestor, head) {
  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', ancestor, head], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function detect({ repo, base, head, last }) {
  for (const [name, value] of [['base', base], ['head', head]]) {
    if (!SHA.test(value)) throw new Error(`--${name} must be a full commit SHA`)
  }
  const skip = (reason) => ({
    base,
    head,
    files: [],
    summary: { changed: 0, testable: 0, backend: false, frontend: false, testsChanged: [] },
    shouldRun: false,
    reason,
  })
  const message = git(repo, 'log', '-1', '--format=%B', head)
  if (message.split('\n').some((line) => line.trim() === AGENT_TRAILER)) return skip('Head commit was created by the test agent.')
  if (last === head) return skip('This commit was already processed.')
  // `last` comes from our own bot comment; ignore it unless it is a real ancestor.
  const since = last && SHA.test(last) && isAncestor(repo, last, head)
    ? gitChanges(repo, last, head).map((change) => change.path)
    : undefined
  const result = { base, head, lastProcessed: since ? last : null, ...analyzeChanges(gitChanges(repo, base, head), { repo, since }) }
  return attachDiffs(result, repo, base, head)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1]
  return args
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2))
  const result = detect({ repo: path.resolve(args.repo ?? '.'), base: args.base, head: args.head, last: args.last || undefined })
  writeFileSync(args.out ?? 'changes.json', `${JSON.stringify(result, null, 2)}\n`)
  const outputs = {
    should_run: String(result.shouldRun),
    backend: String(result.summary.backend),
    frontend: String(result.summary.frontend),
    reason: result.reason,
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''))
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = result.files.map((file) => `| \`${file.path}\` | ${file.kind} | ${file.testable ? 'yes' : file.skipReason} |`)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [`### Test agent: change analysis`, '', `**${result.reason}**`, '', '| File | Kind | Testable |', '| --- | --- | --- |', ...rows, ''].join('\n'),
    )
  }
  console.log(JSON.stringify(outputs))
}
