import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))

it('invalidates stats after creating a task', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({
      title: 'x',
      description: '',
      priority: 'low',
      due_date: null,
      completed: false,
    }),
  )
  expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats })
})
