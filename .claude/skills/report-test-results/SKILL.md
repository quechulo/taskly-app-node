---
name: report-test-results
description: Produce the test agent's final structured report - one decision per analysed source file, suspected defects and notes - in the exact JSON shape the runner validates and the PR comment renders. Use as the last step of every run.
---

# Report test results

Your final answer is a JSON object matching [`report.schema.json`](report.schema.json). The runner enforces it as structured output. Use exactly these fields; anything else is rejected.

| Field | Content |
| --- | --- |
| `summary` | 2–4 plain sentences for reviewers: what changed, what is now tested, anything they should look at. |
| `decisions[]` | **One entry per testable file** from the change analysis in PR mode, or per file you worked on in coverage mode. Use `{ file, action, reason, testFiles }`. |
| `suspectedDefects[]` | Source behaviour you believe is wrong: `{ file, description, evidence }`. Evidence means the input, the expected and actual results, and why you believe the expectation. |
| `notes[]` | Short items: uncovered code left on purpose, type errors that existed before you, follow-ups. |

## Writing decisions

- `action` is `create`, `update` or `skip`. Use the rules in the `analyze-pr-changes` skill.
- `reason` names the **behaviour** you covered, not the activity. Good: "Covers the new GET /stats route: success shape, `today` validation (422) and route order before /:id." Bad: "Added tests."
- A `skip` reason must say why no test is needed and what proves it. Examples: the existing tests that still pass, or coverage figures from the `coverage` tool.
- `testFiles` lists only files you actually created or modified for this source file. For `skip`, list the existing tests that cover it.

## What you don't report

Test pass counts, coverage percentages and which skills you used are recorded by the runner from what really happened. The verify job then re-runs everything independently. Don't restate numbers in `summary` unless they come from your last tool call.

## Example

```json
{
  "summary": "Covered the new task statistics endpoint and its repository aggregation, and updated the router fake for the extended TodoStore interface. One suspected defect: overdue tasks include completed ones.",
  "decisions": [
    {
      "file": "backend/src/features/todos/repository.ts",
      "action": "update",
      "reason": "New stats(today) method: groupBy arguments, mapping of counts per priority and status, overdue filter, empty table.",
      "testFiles": ["backend/tests/repository.test.ts"]
    },
    {
      "file": "frontend/src/features/todos/hooks/useTodosQuery.ts",
      "action": "skip",
      "reason": "Import order changed only; no behaviour change. Existing tests in useTodosQuery.test.tsx pass unchanged.",
      "testFiles": ["frontend/src/features/todos/hooks/useTodosQuery.test.tsx"]
    }
  ],
  "suspectedDefects": [
    {
      "file": "backend/src/features/todos/repository.ts",
      "description": "Overdue count includes completed tasks.",
      "evidence": "stats('2026-10-15') with one completed task due 2026-10-01 returns overdue: 1; the UI's isOverdue() excludes completed tasks."
    }
  ],
  "notes": []
}
```
