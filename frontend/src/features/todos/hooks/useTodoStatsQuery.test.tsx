import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodoStatsQuery } from './useTodoStatsQuery'

vi.mock('../api/todos', () => ({ todosApi: { stats: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

it('fetches stats for the local date, keyed by that date', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12))
  const stats = {
    total: 1,
    active: 1,
    completed: 0,
    overdue: 0,
    by_priority: { low: 0, medium: 1, high: 0 },
  }
  vi.mocked(todosApi.stats).mockResolvedValue(stats)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useTodoStatsQuery(), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual(stats)
  expect(todosApi.stats).toHaveBeenCalledWith(
    '2026-10-15',
    expect.any(AbortSignal),
  )
  expect(queryClient.getQueryData([...todoKeys.stats, '2026-10-15'])).toEqual(
    stats,
  )
})
