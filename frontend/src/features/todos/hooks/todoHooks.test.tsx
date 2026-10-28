import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useTodosBusy } from './useTodosBusy'
import { useTodosQuery } from './useTodosQuery'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

beforeEach(() => vi.clearAllMocks())

const other = { ...todoFixture, id: 8, title: 'Other' }
const input = {
  title: 'x',
  description: '',
  priority: 'low' as const,
  due_date: null,
  completed: false,
}

describe('useTodosQuery', () => {
  it('fetches the list and forwards the abort signal', async () => {
    vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
    const { wrapper } = setup()
    const { result } = renderHook(() => useTodosQuery(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([todoFixture])
    expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
})

describe('useCreateTodoMutation', () => {
  it('prepends the saved todo and replaces a duplicate', async () => {
    const saved = { ...todoFixture, title: 'New' }
    vi.mocked(todosApi.create).mockResolvedValue(saved)
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(todoKeys.list, [other, todoFixture])
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(todosApi.create).toHaveBeenCalledWith(input)
    expect(queryClient.getQueryData(todoKeys.list)).toEqual([saved, other])
  })

  it('creates the list when nothing is cached', async () => {
    vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })
})

describe('useUpdateTodoMutation', () => {
  it('replaces the matching todo in the cache', async () => {
    const saved = { ...todoFixture, completed: true }
    vi.mocked(todosApi.update).mockResolvedValue(saved)
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(todoKeys.list, [todoFixture, other])
    const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ id: 7, input: { completed: true } }),
    )
    expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
    expect(queryClient.getQueryData(todoKeys.list)).toEqual([saved, other])
  })

  it('leaves an uncached list undefined', async () => {
    vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
    await act(() => result.current.mutateAsync({ id: 7, input: {} }))
    expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
  })
})

describe('useDeleteTodoMutation', () => {
  it('removes the todo from the cache', async () => {
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(todoKeys.list, [todoFixture, other])
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await act(() => result.current.mutateAsync(7))
    expect(todosApi.remove).toHaveBeenCalledWith(7)
    expect(queryClient.getQueryData(todoKeys.list)).toEqual([other])
  })

  it('leaves an uncached list undefined', async () => {
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await act(() => result.current.mutateAsync(7))
    expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
  })
})

describe('useTodosBusy', () => {
  it('is true while a todo mutation is pending', async () => {
    let release: (value: undefined) => void = () => {}
    vi.mocked(todosApi.remove).mockReturnValue(
      new Promise<undefined>((resolve) => {
        release = resolve
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({ busy: useTodosBusy(), del: useDeleteTodoMutation() }),
      { wrapper },
    )
    expect(result.current.busy).toBe(false)
    let promise: Promise<void> = Promise.resolve()
    act(() => {
      promise = result.current.del.mutateAsync(7)
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => {
      release(undefined)
      await promise
    })
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})
