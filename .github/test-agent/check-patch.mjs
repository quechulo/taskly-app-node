#!/usr/bin/env node
// Gate for the agent's patch: it may only add or modify regular test files.
//
//   node check-patch.mjs <tests.patch>     exit 0 = accepted, 1 = rejected (JSON on stdout)
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWritableTestPath } from '../../.claude/test-path-policy.mjs'

const LIMITS = { files: 40, addedLines: 4000 }

const FORBIDDEN_CONTENT = [
  [/\b(?:it|test|describe|suite)\.(?:only|skip|todo|skipIf|runIf)\b|\b[xf](?:it|describe)\(/, 'focused, skipped or todo tests'],
  [/sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a credential'],
  [/process\.env\.(?:ANTHROPIC|GITHUB|ACTIONS)_/, 'access to CI credentials'],
  [/\b(?:child_process|node:child_process)\b/, 'spawning processes'],
  // The runner process holds the API key; its environment is readable via /proc on Linux.
  [/['"`]\/proc\/|\benviron\b|JSON\.stringify\(\s*process\.env\s*\)/, 'reading process environments'],
]

/** Parses `git diff --cached --binary` output and applies the policy. */
export function checkPatch(patch) {
  const violations = []
  const files = []
  let current
  let addedLines = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line)
      if (!match) {
        violations.push(`Unparseable or quoted path: ${line.slice(11, 200)}`)
        current = undefined
        continue
      }
      current = { path: match[2], status: 'modified', addedLines: 0 }
      files.push(current)
      for (const target of new Set([match[1], match[2]])) {
        if (!isWritableTestPath(target)) violations.push(`${target}: not a writable test path`)
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('new file mode ')) {
      current.status = 'added'
      if (line !== 'new file mode 100644') violations.push(`${current.path}: new file must be a regular non-executable file (${line})`)
    } else if (line.startsWith('deleted file mode')) {
      violations.push(`${current.path}: deleting files is not allowed`)
    } else if (/^(?:old|new) mode /.test(line)) {
      violations.push(`${current.path}: file mode changes are not allowed`)
    } else if (/^(?:rename|copy) (?:from|to) /.test(line)) {
      violations.push(`${current.path}: renames and copies are not allowed`)
    } else if (line === 'GIT binary patch' || line.startsWith('Binary files ')) {
      violations.push(`${current.path}: binary content is not allowed`)
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines++
      current.addedLines++
      for (const [pattern, label] of FORBIDDEN_CONTENT) {
        if (pattern.test(line)) violations.push(`${current.path}: contains ${label}: ${line.slice(1, 120).trim()}`)
      }
    }
  }
  if (files.length > LIMITS.files) violations.push(`Too many files: ${files.length} > ${LIMITS.files}`)
  if (addedLines > LIMITS.addedLines) violations.push(`Too many added lines: ${addedLines} > ${LIMITS.addedLines}`)
  return { ok: violations.length === 0, files, addedLines, violations: [...new Set(violations)] }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = checkPatch(readFileSync(process.argv[2], 'utf8'))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.ok ? 0 : 1
}
