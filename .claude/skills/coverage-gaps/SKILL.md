---
name: coverage-gaps
description: Find and prioritise untested code from Vitest lcov coverage, with exact uncovered line ranges, branches and functions per file. Use in coverage mode to choose what to test next, or in PR mode to prove that changed code is already covered.
---

# Coverage gaps

## Measure

- **In the agent:** call `mcp__test-tools__coverage` with `app`.
  - Optionally pass `files` (repo-relative source paths) to focus on specific files.
  - Optionally pass `threshold`. Files below it on any metric are listed, worst first.
  - It runs the app's whole suite with coverage, so call it at the start and at the end, not after every edit.
- **Locally:**
  1. `cd <app> && npm run test:coverage`
  2. `node .claude/skills/coverage-gaps/scripts/coverage-gaps.mjs --app <app> --threshold 90 [--files a.ts,b.ts] [--format markdown]`

Each gap has these fields:

| Field | Meaning |
| --- | --- |
| `lines`, `branches`, `functions` | Percentages |
| `uncoveredLines` | Line ranges never executed |
| `uncoveredBranchLines` | Lines with a branch outcome never taken: the other side of an `if`, `??`, `?:` or `&&` |
| `uncoveredFunctions` | Callbacks and functions never called, e.g. an `onSuccess` handler or a route handler |

Coverage only counts what each app's config includes:
- **backend:** `src/**/*.ts` except `types.ts` and `src/generated/**`
- **frontend:** `src/**` except the design system, types, barrels, constants, `main.tsx`, `lib/queryClient.ts` and `api/queryKeys.ts`

Don't write tests for excluded files to raise the numbers.

## Prioritise

1. Files at 0%, which usually have a whole module with no test file.
2. Uncovered **branches** in logic: error handling, validation failures, `404`/`422` paths, empty states, disabled states, and cache updates when the cache is empty.
3. Uncovered **functions**: event handlers, mutation callbacks, shutdown handlers.
4. Remaining lines.

Read the source around each uncovered range before you write anything. The goal is to pin behaviour; executing lines isn't enough. A test that runs a line without asserting its effect doesn't count.

## Targets

- Coverage mode: at least 90% lines, branches and functions per app, with every changed or listed file as close to 100% as is reasonable.
- If a gap can't be reached sensibly by a unit test (for example a defensive `res.headersSent` branch), leave it uncovered and explain why in the report's `notes`. Don't contort the test to reach it.
- Finish with one more `coverage` call per app, so the final numbers come from a real run.
