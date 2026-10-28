#!/usr/bin/env node
// Turns an lcov report into a ranked list of coverage gaps with the exact
// uncovered lines, branches and functions, so tests can target them.
//
//   node coverage-gaps.mjs --app backend [--repo .] [--files a.ts,b.ts] [--threshold 90] [--format json|markdown]
//
// Run `npm run test:coverage` in the app first; both apps write coverage/lcov.info.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pct = (hit, found) => (found === 0 ? 100 : Math.round((hit / found) * 10000) / 100)

/** Collapses sorted line numbers into "3-5, 9" style ranges. */
export function toRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b)
  const ranges = []
  for (const line of sorted) {
    const last = ranges.at(-1)
    if (last && line === last[1] + 1) last[1] = line
    else ranges.push([line, line])
  }
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`)).join(', ')
}

/**
 * @param {string} text
 * @param {{ appDir?: string }} [options]
 */
export function parseLcov(text, { appDir = '' } = {}) {
  const files = []
  let current
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const [tag, value = ''] = line.split(/:(.*)/s)
    if (tag === 'SF') {
      const relative = path.isAbsolute(value) && appDir ? path.relative(appDir, value) : value
      current = { file: relative.split(path.sep).join('/'), lines: new Map(), branches: [], functions: new Map(), fnHits: new Map() }
    } else if (!current) {
      continue
    } else if (tag === 'DA') {
      const [lineNo, hits] = value.split(',').map(Number)
      current.lines.set(lineNo, (current.lines.get(lineNo) ?? 0) + hits)
    } else if (tag === 'BRDA') {
      const [lineNo, , , taken] = value.split(',')
      current.branches.push({ line: Number(lineNo), taken: taken === '-' ? 0 : Number(taken) })
    } else if (tag === 'FN') {
      const [lineNo, name] = value.split(/,(.*)/s)
      current.functions.set(name, Number(lineNo))
    } else if (tag === 'FNDA') {
      const [hits, name] = value.split(/,(.*)/s)
      current.fnHits.set(name, Number(hits))
    } else if (line === 'end_of_record') {
      files.push(summarize(current))
      current = undefined
    }
  }
  return files
}

function summarize({ file, lines, branches, functions, fnHits }) {
  const uncoveredLines = [...lines].filter(([, hits]) => hits === 0).map(([line]) => line)
  const uncoveredBranches = branches.filter((branch) => branch.taken === 0).map((branch) => branch.line)
  const uncoveredFunctions = [...functions]
    .filter(([name]) => (fnHits.get(name) ?? 0) === 0)
    .map(([name, line]) => `${name} (line ${line})`)
  return {
    file,
    lines: pct(lines.size - uncoveredLines.length, lines.size),
    branches: pct(branches.length - uncoveredBranches.length, branches.length),
    functions: pct(functions.size - uncoveredFunctions.length, functions.size),
    uncoveredLines: toRanges(uncoveredLines),
    uncoveredBranchLines: toRanges(uncoveredBranches),
    uncoveredFunctions,
  }
}

/**
 * Files below the threshold on any metric, worst first. With `files`, only
 * those (repo- or app-relative) paths are reported, whatever their coverage.
 * @param {ReturnType<typeof parseLcov>} report
 * @param {{ threshold?: number, files?: string[] }} [options]
 */
export function rankGaps(report, { threshold = 100, files } = {}) {
  const wanted = files?.map((file) => file.replace(/^(?:backend|frontend)\//, ''))
  return report
    .filter((entry) => (wanted ? wanted.includes(entry.file) : Math.min(entry.lines, entry.branches, entry.functions) < threshold))
    .sort((a, b) => a.lines + a.branches + a.functions - (b.lines + b.branches + b.functions))
}

export function toMarkdown(app, gaps) {
  if (gaps.length === 0) return `**${app}**: no coverage gaps.\n`
  const rows = gaps.map(
    (gap) => `| \`${gap.file}\` | ${gap.lines}% | ${gap.branches}% | ${gap.functions}% | ${gap.uncoveredLines || '–'} |`,
  )
  return [`**${app}**`, '', '| File | Lines | Branches | Functions | Uncovered lines |', '| --- | --: | --: | --: | --- |', ...rows, ''].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, arg, i, all) => (i % 2 === 0 ? [...pairs, [arg.replace(/^--/, ''), all[i + 1]]] : pairs), []),
  )
  if (!['backend', 'frontend'].includes(args.app)) {
    process.stderr.write('Usage: coverage-gaps.mjs --app backend|frontend [--repo .] [--files a,b] [--threshold 90] [--format json|markdown]\n')
    process.exit(1)
  }
  const appDir = path.resolve(args.repo ?? '.', args.app)
  const report = parseLcov(readFileSync(path.join(appDir, 'coverage/lcov.info'), 'utf8'), { appDir })
  const gaps = rankGaps(report, { threshold: Number(args.threshold ?? 100), files: args.files?.split(',') })
  process.stdout.write(args.format === 'markdown' ? toMarkdown(args.app, gaps) : `${JSON.stringify(gaps, null, 2)}\n`)
}
