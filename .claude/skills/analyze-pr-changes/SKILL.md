---
name: analyze-pr-changes
description: Decide which files changed in a pull request need new or updated unit tests. Classifies changed files, maps each testable source file to its conventional test file, lists existing tests that import or mock it, and gives create/update/skip rules. Use at the start of PR-mode test generation.
---

# Analyze PR changes

## Get the analysis

- **In the PR workflow:** call `mcp__test-tools__analyze_changes`. The detect job has already computed it from `git diff base...head`.
- **Locally:** `node .claude/skills/analyze-pr-changes/scripts/analyze-changes.mjs --repo . --base origin/main --head HEAD`

Each file in the analysis has these fields:

| Field | Meaning |
| --- | --- |
| `kind` | `source` (testable), `test`, `test-support`, `types`, `generated`, `design-system`, `story`, `barrel`, `constants`, `excluded`, `style`, `config`, `docs`, `automation`, `deleted`, `unsafe` |
| `testable` | `true` only for `source`. The rules mirror the coverage include/exclude lists of both apps, so testable means "counted by coverage". |
| `expectedTest` / `expectedTestExists` | The conventional test location: `backend/tests/<name>.test.ts`, or a colocated `<name>.test.ts(x)` in the frontend. |
| `relatedTests` | Existing tests that import or `vi.mock` the module. These break silently when a signature changes. |
| `diff` | The unified diff of the file in this PR (capped). |
| `changedSinceLastRun` | Present on re-runs. `false` means an earlier agent run already handled this file. |

Never act on non-testable files. Their `skipReason` goes straight into the report.

## Decide per testable file

Read the `diff`, then the full source file. Then pick one action.

**create:** no test file exercises this module yet. Examples: a new module, hook, component, endpoint or repository method.

**update:** a test file exists, and the change does any of the following:
- adds or changes behaviour: a new branch, parameter, return field, route, error path or UI state;
- changes a signature or return shape that tests or mocks in `relatedTests` depend on. For example, a hook now returns an extra field that `TodosPage.test.tsx` mocks, or a repository gains a method that the router test's fake repository must provide;
- makes existing assertions wrong. Fix them to the **new intended behaviour**, which you can see from the diff. Never just make them match whatever the code now does.

**skip:** give one of these reasons.
- A pure refactor with no behaviour change, and the existing tests still pass. Name the tests that prove it.
- Formatting, comments or renames only.
- Behaviour is already fully covered. Prove it with `mcp__test-tools__coverage` and `files: [path]`, and cite the numbers.
- The code can't be tested by unit tests (for example a process entry point needing a real server). Say what would cover it instead.

Re-runs: when `changedSinceLastRun` is `false`, re-check that the existing tests still pass. Don't rewrite them.

## Order of work

Work through backend files before frontend files. Within each app, write lower layers before the code that uses them: validators and utils, then repositories, API clients and hooks, then routers and components. That way the tests for later layers can rely on what the earlier tests established.
