---
name: frontend-unit-tests
description: Conventions and patterns for unit tests of the Taskly frontend (React 19, TanStack Query 5, styled-components design system, Vitest, React Testing Library, user-event), including design-system mocks, hook mocking, testing React Query hooks with a real QueryClient, fetch mocking and fake timers. Use before writing or updating any *.test.ts(x) in frontend/src.
---

# Frontend unit tests

## Layout and style

- Tests are **colocated**: `Foo.tsx` gets `Foo.test.tsx`, and `useFoo.ts` gets `useFoo.test.ts`. Use `.tsx` whenever the file contains JSX, including hook tests with a wrapper component.
- Prettier rules (`frontend/.prettierrc.json`): **no semicolons, single quotes, trailing commas**, 80 columns. The workflow formats test files after you, but write them in that style anyway.
- Import test APIs explicitly: `import { describe, expect, it, vi, beforeEach } from 'vitest'`.
- `src/test/setup.ts` loads jest-dom matchers and runs `cleanup` after each test. Don't edit it.
- Shared data:
  - `src/test/todoFixture.ts` exports `todoFixture`, a `Todo`. Spread it for variants.
  - Reusable helpers, such as a QueryClient wrapper, go in `src/test/`.

## Rendering components

Always mock the design system. It returns the plain native elements that RTL queries by role:

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
```

The relative path must match the import in the component under test. In the mocks:
- `Alert` renders `data-testid="alert"`.
- `Drawer` renders `role="dialog"` named by `title`, plus a "Close" button.
- `Input` and `Select` render a `<label>` wrapping the control, so `getByLabelText('Status')` works.
- Every mock is a `vi.fn`, so you can assert props: `expect(vi.mocked(Alert).mock.calls[0][0]).toEqual(expect.objectContaining({ variant: 'success' }))`. Clear them with `beforeEach(() => vi.clearAllMocks())` when you do.

Query by **role and accessible name** first (`getByRole('button', { name: 'Delete task' })`). Fall back to `getByLabelText`, then `getByText`. Interact through `const user = userEvent.setup()` and `await user.click(...)` / `user.type(...)` / `user.selectOptions(...)`. Don't use `fireEvent` for user actions.

## Isolating components from hooks and children

Page and dialog components are tested with their hooks mocked:

```tsx
vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))

vi.mocked(useDeleteTodoMutation).mockReturnValue({
  isPending: false,
  error: null,
  mutateAsync: vi.fn().mockResolvedValue(undefined),
} as unknown as ReturnType<typeof useDeleteTodoMutation>)
```

- Mock child components that have their own tests with tiny stand-ins: `vi.mock('./TodoItem', () => ({ TodoItem: () => <li>Task</li> }))`. To exercise callbacks a parent passes down, give the stand-in a button that calls the prop, as `TodoEditor.test.tsx` does with `TodoForm`.
- **When a hook gains a new return field or a new hook is used by a component, update every test that mocks it.** `relatedTests` in the change analysis lists them. A mock missing the new field usually still renders, but it hides the new behaviour.
- **Async flows:**
  - Cover both outcomes: a resolved `mutateAsync` (success callback and notice), and a rejected one (the callback is *not* called and the error is shown).
  - Cover the pending and disabled state (`isPending: true` or `busy`). Buttons must be disabled and say e.g. "Deleting…".
  - Use `await waitFor(...)` or `findBy*` for effects after promises.

## React Query hooks

Test hooks against a **real** `QueryClient` with the API module mocked. That exercises cache updates for real:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { todosApi } from '../api/todos'
import { todoKeys } from '../api/queryKeys'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

const { queryClient, wrapper } = setup()
queryClient.setQueryData(todoKeys.list, [todoFixture])
const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
await result.current.mutateAsync({ id: 7, input: { completed: true } })
expect(queryClient.getQueryData(todoKeys.list)).toEqual([{ ...todoFixture, completed: true }])
```

- Assert the API call arguments, the resulting cache contents, and the edge case where the list isn't cached yet (`undefined`).
- When a mutation **invalidates** queries, spy with `vi.spyOn(queryClient, 'invalidateQueries')` and assert the exact `queryKey`.
- For queries, wait with `await waitFor(() => expect(result.current.isSuccess).toBe(true))`. Assert that the `signal` is forwarded: `expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))`.
- `useTodosBusy` uses `useIsMutating`. Test it by starting a mutation whose promise you control (`new Promise((resolve) => { release = resolve })`).
- `AppProviders` accepts a `client` prop. Use it to render a component under real providers.

## HTTP layer (`src/lib/http.ts`)

Stub `fetch` globally and restore it:

```ts
const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => vi.unstubAllGlobals())

fetchMock.mockResolvedValue(new Response(JSON.stringify([todoFixture]), { status: 200 }))
```

Cover each of these:
- the `/api` prefix and the JSON header merged with caller headers;
- `204` returning `undefined`;
- `422` returning the fixed validation message;
- `detail` as a string versus a non-string;
- a non-JSON error body;
- a network failure giving the friendly message;
- an aborted request rethrowing the original error.

## Time and dates

- Timers (`useNotice` clears after 4 s): `vi.useFakeTimers()`, then `act(() => vi.advanceTimersByTime(4000))`, and `vi.useRealTimers()` in `afterEach`. Don't use `userEvent` with fake timers unless you set it up with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
- "Today"-dependent logic such as overdue checks: `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime(new Date(2026, 9, 15, 12))`. Use local-time constructors, because the code compares local dates. Assert both sides of the boundary: yesterday, today and tomorrow.
- `formatDate` uses `Intl` with `en-GB`. Assert the formatted output, e.g. `'15 Oct 2026'`.

## Checklist before running

- Every new prop, branch, state (loading, empty, error, pending, disabled) and callback from the diff has a test.
- Tests that mock a changed hook or component were updated.
- No real network, no real timers in timing logic, and no `act` warnings left unexplained.
