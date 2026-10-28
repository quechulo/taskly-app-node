import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodoStatsQuery } from './hooks/useTodoStatsQuery'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useTodoStatsQuery', () => ({ useTodoStatsQuery: vi.fn() }))
vi.mock('./components/TodoStatsSummary', () => ({
  TodoStatsSummary: ({
    stats,
    loading,
  }: {
    stats?: { total: number }
    loading: boolean
  }) => (
    <p>{loading ? 'Stats loading' : `Stats total ${stats?.total ?? 'none'}`}</p>
  ),
}))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    onCreate,
    disabled,
  }: {
    onCreate: () => void
    disabled: boolean
  }) => (
    <button disabled={disabled} onClick={onCreate}>
      Header create
    </button>
  ),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: (props: {
    onCreate: () => void
    onToggle: (t: unknown) => void
    onEdit: (t: unknown) => void
    onDelete: (t: unknown) => void
  }) => (
    <div>
      <button onClick={props.onCreate}>List create</button>
      <button onClick={() => props.onToggle(todoFixture)}>Toggle</button>
      <button onClick={() => props.onEdit(todoFixture)}>Edit</button>
      <button onClick={() => props.onDelete(todoFixture)}>Delete</button>
    </div>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: (props: {
    todo: unknown
    onClose: () => void
    onSaved: (n: string) => void
  }) => (
    <div>
      <p>{props.todo === 'new' ? 'Editor new' : 'Editor existing'}</p>
      <button onClick={props.onClose}>Editor close</button>
      <button onClick={() => props.onSaved('Saved!')}>Editor save</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: (props: { onClose: () => void; onDeleted: () => void }) => (
    <div>
      <p>Delete dialog</p>
      <button onClick={props.onClose}>Dialog close</button>
      <button onClick={props.onDeleted}>Dialog deleted</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({ SuccessNotice: () => null }))

const notify = vi.fn()
const refetch = vi.fn()
const reset = vi.fn()
const mutateAsync = vi.fn()

function arrange({
  busy = false,
  query = {},
  mutationError = null,
}: {
  busy?: boolean
  query?: Record<string, unknown>
  mutationError?: Error | null
} = {}) {
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [todoFixture],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch,
    ...query,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset,
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodoStatsQuery).mockReturnValue({
    data: { total: 4 },
    isPending: false,
  } as unknown as ReturnType<typeof useTodoStatsQuery>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  refetch.mockResolvedValue(undefined)
})

describe('TodosPage', () => {
  it('displays a query failure and resets mutation errors before retrying', async () => {
    const user = userEvent.setup()
    arrange({
      query: {
        data: [],
        isError: true,
        error: new Error('The server is unavailable.'),
      },
    })
    render(<TodosPage />)
    expect(screen.getByTestId('alert')).toHaveTextContent(
      'The server is unavailable.',
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
      refetch.mock.invocationCallOrder[0],
    )
  })

  it('treats missing data as an empty list and disables create while pending', () => {
    arrange({ query: { data: undefined, isPending: true } })
    render(<TodosPage />)
    expect(screen.getByRole('button', { name: 'Header create' })).toBeDisabled()
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  })

  it('passes stats data and pending state to the summary', () => {
    arrange()
    const { unmount } = render(<TodosPage />)
    expect(screen.getByText('Stats total 4')).toBeVisible()
    unmount()
    vi.mocked(useTodoStatsQuery).mockReturnValue({
      data: undefined,
      isPending: true,
    } as unknown as ReturnType<typeof useTodoStatsQuery>)
    render(<TodosPage />)
    expect(screen.getByText('Stats loading')).toBeVisible()
  })

  it('shows a mutation error and disables retry while busy', () => {
    arrange({ busy: true, mutationError: new Error('Update failed') })
    render(<TodosPage />)
    expect(screen.getByTestId('alert')).toHaveTextContent('Update failed')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  })

  it('notifies when a task is completed', async () => {
    arrange()
    mutateAsync.mockResolvedValue({ ...todoFixture, completed: true })
    render(<TodosPage />)
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Toggle' }))
    expect(mutateAsync).toHaveBeenCalledWith({
      id: todoFixture.id,
      input: { completed: true },
    })
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Another task complete. Well done!'),
    )
  })

  it('notifies when a task is marked active', async () => {
    arrange()
    mutateAsync.mockResolvedValue({ ...todoFixture, completed: false })
    render(<TodosPage />)
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Task marked as active.'),
    )
  })

  it('swallows toggle errors without notifying', async () => {
    arrange()
    mutateAsync.mockRejectedValue(new Error('fail'))
    render(<TodosPage />)
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not toggle while busy', async () => {
    arrange({ busy: true })
    render(<TodosPage />)
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Toggle' }))
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('opens, closes and saves the editor', async () => {
    const user = userEvent.setup()
    arrange()
    render(<TodosPage />)
    await user.click(screen.getByRole('button', { name: 'Header create' }))
    expect(screen.getByText('Editor new')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Editor close' }))
    expect(screen.queryByText('Editor new')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'List create' }))
    expect(screen.getByText('Editor new')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Editor save' }))
    expect(notify).toHaveBeenCalledWith('Saved!')
    expect(screen.queryByText('Editor new')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Editor existing')).toBeVisible()
  })

  it('opens, closes and confirms the delete dialog', async () => {
    const user = userEvent.setup()
    arrange()
    render(<TodosPage />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete dialog')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Dialog close' }))
    expect(screen.queryByText('Delete dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Dialog deleted' }))
    expect(notify).toHaveBeenCalledWith('Task deleted.')
    expect(screen.queryByText('Delete dialog')).not.toBeInTheDocument()
  })
})
