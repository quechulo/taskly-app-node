---
name: run-and-verify-tests
description: Run, debug and verify unit tests written by the agent - targeted Vitest runs, type checking, a bounded fix loop, distinguishing test mistakes from source defects, and a final shuffled full-suite run. Use after writing or editing tests and before reporting.
---

# Run and verify tests

## Tools

| Need | Agent tool | Local equivalent |
| --- | --- | --- |
| Run specific test files | `run_tests({ app, files: ['backend/tests/x.test.ts'] })` | `cd backend && npx vitest run tests/x.test.ts` |
| Run the whole suite, shuffled | `run_tests({ app, shuffle: true })` | `npx vitest run --sequence.shuffle` |
| Type-check, tests included | `typecheck({ app })` | `npm run typecheck` |
| Coverage | `coverage({ app, files })` | `npm run test:coverage` |

- `files` must be existing test files of that app, as repo-relative paths.
- Results give pass and fail counts, and for each failure the file, test name and message.

## Loop

1. **Targeted run.** Run only the files you created or changed.
2. **Each failure.** Read the message, then decide which of these it is:
   - **The test is wrong:**
     - a wrong query or role name;
     - a missing mock or a mock with the wrong shape;
     - a missing `await` or `waitFor`;
     - a wrong fixture value;
     - wrong expectations about defaults;
     - leaked state between tests (mocks not reset, env not unstubbed, fake timers left on).

     Fix the test.
   - **The source is wrong:** the test encodes the intended behaviour, which comes from the diff, the API contract (`backend/openapi.json`), validation rules, UI copy, or how neighbouring code uses the module, and the code does something else. **Don't change the assertion to match.** Remove the test, and record a suspected defect: what you expected, what happened, and the input.
   - **You can't tell:** prefer the more conservative reading. Remove the test and mention it in `notes`.
3. **Bounded effort.** Allow at most **three fix attempts per failing test**. After that, remove it and explain in `notes`. Never leave a failing, skipped or `.todo` test behind.
4. **Type-check.** Run `typecheck({ app })` once your files pass. Fix type errors in **your test files**. If errors are reported in source files you didn't touch, they existed before you; mention them in `notes` and don't attempt fixes.
5. **Full suite, shuffled.** Run `run_tests({ app, shuffle: true })` once per app you touched. This catches order-dependent tests and tests elsewhere broken by your fixture changes. The workflow repeats this independently, so tests that only pass in one order will be rejected.

## Signs of a bad test

Rework any test that matches one of these, even if it passes:
- It passes with the code under test deleted or stubbed out. For example, everything it asserts is mocked.
- It only asserts that something renders, or that something "was called", without checking arguments or results.
- It depends on wall-clock time, the time zone, or execution order.
- It duplicates another test with different literals. Use `it.each` instead.
- It asserts on private details: component state, hook internals, CSS classes, or styled-components output.

## Done means

- Every test file you touched passes.
- `typecheck` passes, or the only errors are ones that existed before you and are recorded in notes.
- One shuffled full-suite run passed per touched app.
- No `.only`, `.skip` or `.todo`, and no `console.log`. Unexpected `console.error` output in your tests is investigated, then asserted or silenced on purpose with `vi.spyOn(console, 'error')`.
