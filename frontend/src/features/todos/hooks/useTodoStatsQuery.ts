import { useQuery } from '@tanstack/react-query'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { toLocalDateString } from '../utils/todos'

export function useTodoStatsQuery() {
  // Overdue depends on the user's local date, so it is part of the cache key.
  const today = toLocalDateString()
  return useQuery({
    queryKey: [...todoKeys.stats, today],
    queryFn: ({ signal }) => todosApi.stats(today, signal),
  })
}
