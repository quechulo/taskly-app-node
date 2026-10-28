# Example PR comment (local dry run)

> Rendered by `.github/test-agent/render-comment.mjs` from the artifacts of the local dry run of the full pipeline on `feat/task-statistics` (detect → agent in PR mode → patch gate → `verify.mjs` on a clean worktree). In a dry run nothing is pushed, so `dry-run` stands in for the commit SHA and there is no workflow-run link. On GitHub, the `publish` job posts this as a sticky comment.

---

<!-- test-agent-report -->
<!-- test-agent:last-sha=269ee7faefc26ab82de783be099d8e4a894d7911 -->
## 🧪 Test agent

**✅ Unit tests created/updated and verified**, committed as `dry-run` to this branch.

> I added or updated tests for every behaviour in the PR. That covers the new stats endpoint, its validator, the repository aggregation, the stats API client, the stats query hook, the summary component, and the stats-cache invalidation done by the three mutation hooks. Both apps pass their targeted runs, typecheck and shuffled full-suite runs.

### Decisions

| Source file | Action | Test files | Reason |
| --- | --- | --- | --- |
| `backend/src/features/todos/validators.ts` | **update** | `backend/tests/validators.test.ts` | Added tests for statsQuerySchema: optional date, valid leap day, and rejection of invalid or datetime values. |
| `backend/src/features/todos/repository.ts` | **update** | `backend/tests/repository.test.ts` | Added tests for stats(): aggregation of grouped counts, the groupBy and count query arguments, an unknown priority counted only in the totals, and the empty case. |
| `backend/src/features/todos/router.ts` | **update** | `backend/tests/router.test.ts` | Added tests for GET /stats: the explicit date, the default UTC date, a 422 on an invalid date, and /stats being routed before /:id. Added stats to the fake repository. |
| `frontend/src/features/todos/utils/todos.ts` | **update** | `frontend/src/features/todos/utils/todos.test.ts` | Added tests for toLocalDateString, covering zero padding and the default current date. isOverdue still passes its existing tests. |
| `frontend/src/features/todos/api/todos.ts` | **update** | `frontend/src/features/todos/api/todos.test.ts` | Added a test for todosApi.stats: URL encoding of the date and forwarding of the abort signal. |
| `frontend/src/features/todos/components/TodoStatsSummary.tsx` | **create** | `frontend/src/features/todos/components/TodoStatsSummary.test.tsx` | New component. Tests cover loading, missing stats, the empty total, the percent text, the overdue badge being shown or hidden, and the priority breakdown. |
| `frontend/src/features/todos/hooks/useTodoStatsQuery.ts` | **create** | `frontend/src/features/todos/hooks/useTodoStatsQuery.test.tsx` | New hook. Tests cover the local-date argument, the abort signal, and the date-keyed cache entry. |
| `frontend/src/features/todos/hooks/useCreateTodoMutation.ts` | **create** | `frontend/src/features/todos/hooks/statsInvalidation.test.tsx` | Tests cover stats invalidation on success and no invalidation on failure. The conventional .ts path was not used because the shared test file contains JSX, so it is .tsx. |
| `frontend/src/features/todos/hooks/useUpdateTodoMutation.ts` | **create** | `frontend/src/features/todos/hooks/statsInvalidation.test.tsx` | Tests cover stats invalidation on success and no invalidation on failure. |
| `frontend/src/features/todos/hooks/useDeleteTodoMutation.ts` | **create** | `frontend/src/features/todos/hooks/statsInvalidation.test.tsx` | Tests cover stats invalidation on success and no invalidation on failure. |
| `frontend/src/features/todos/TodosPage.tsx` | **update** | `frontend/src/features/todos/TodosPage.test.tsx` | Mocked the new useTodoStatsQuery hook and TodoStatsSummary component. Added a test that stats data and the loading state reach the summary. |

### Verification

Independent re-run on a clean checkout, in a job without secrets.

| App | Typecheck | Tests | Shuffled re-run | Format |
| --- | :-: | :-: | :-: | :-: |
| backend | ✅ | ✅ 86/86 | ✅ | – |
| frontend | ✅ | ✅ 90/90 | ✅ | ✅ |

### Coverage of changed files

| File | Lines | Branches | Functions |
| --- | --- | --- | --- |
| `backend/src/features/todos/repository.ts` | 64% → 100% (+36) | 75% → 100% (+25) | 87.5% → 100% (+12.5) |
| `backend/src/features/todos/router.ts` | 89.65% → 100% (+10.35) | 75% → 100% (+25) | 87.5% → 100% (+12.5) |
| `backend/src/features/todos/validators.ts` | 100% → 100% | 100% → 100% | 100% → 100% |
| `frontend/src/features/todos/TodosPage.tsx` | 40.74% → 100% (+59.26) | 33.33% → 100% (+66.67) | 9.09% → 100% (+90.91) |
| `frontend/src/features/todos/api/todos.ts` | 87.5% → 100% (+12.5) | 100% → 100% | 80% → 100% (+20) |
| `frontend/src/features/todos/components/TodoStatsSummary.tsx` | 0% → 100% (+100) | 0% → 100% (+100) | 0% → 100% (+100) |
| `frontend/src/features/todos/hooks/useCreateTodoMutation.ts` | 100% → 100% | 100% → 100% | 100% → 100% |
| `frontend/src/features/todos/hooks/useDeleteTodoMutation.ts` | 100% → 100% | 100% → 100% | 100% → 100% |
| `frontend/src/features/todos/hooks/useTodoStatsQuery.ts` | 66.66% → 100% (+33.34) | 100% → 100% | 50% → 100% (+50) |
| `frontend/src/features/todos/hooks/useUpdateTodoMutation.ts` | 100% → 100% | 100% → 100% | 100% → 100% |
| `frontend/src/features/todos/utils/todos.ts` | 100% → 100% | 100% → 100% | 100% → 100% |

**Totals:** backend lines 90.24% → 100% (+9.76), branches 83.92% → 98.21% (+14.29); frontend lines 85.36% → 100% (+14.64), branches 85.61% → 99.31% (+13.7)

<details><summary>Agent run details</summary>

- **Model:** claude-sonnet-5-5 · **turns:** 40 · **duration:** 69s · **cost:** $0.26
- **Skills used:** `analyze-pr-changes`, `backend-unit-tests`, `frontend-unit-tests` · preloaded: `run-and-verify-tests`, `report-test-results`
- **Tool calls:** analyze_changes ×1, run_tests ×4, typecheck ×2
- Note: The three mutation-hook invalidation tests share one file, statsInvalidation.test.tsx, rather than the conventional per-hook test files.
- Note: The backend stats route defaults to the UTC date when ˋtodayˋ is missing, while the frontend always sends its local date. That is by design, but a client that omits the date can see overdue counts that differ from its local day.

**Not analysed (not unit-testable):**

- `backend/openapi.json`: Configuration, schema or tooling file; outside unit-test scope.
- `backend/src/features/todos/types.ts`: Type declarations only; checked by the compiler, no runtime behaviour.
- `frontend/src/features/todos/api/queryKeys.ts`: Excluded from coverage in vite.config.ts (entry point or static configuration).
- `frontend/src/features/todos/types.ts`: Type declarations only; checked by the compiler, no runtime behaviour.

</details>

<sub>Analysed `269ee7f` · label `skip-test-agent` disables this check</sub>
