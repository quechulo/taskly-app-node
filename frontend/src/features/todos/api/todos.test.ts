import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('requests stats with an encoded date and the abort signal', async () => {
  const signal = new AbortController().signal
  const stats = {
    total: 1,
    active: 1,
    completed: 0,
    overdue: 0,
    by_priority: { low: 0, medium: 1, high: 0 },
  }
  vi.mocked(request).mockResolvedValue(stats)
  await expect(todosApi.stats('2026-10-15', signal)).resolves.toEqual(stats)
  expect(request).toHaveBeenCalledWith('/todos/stats?today=2026-10-15', {
    signal,
  })
  await todosApi.stats('a b&c')
  expect(request).toHaveBeenLastCalledWith('/todos/stats?today=a%20b%26c', {
    signal: undefined,
  })
})

it('patches only writable fields and deletes by id', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(7, { completed: true })
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
  await todosApi.remove(7)
  expect(request).toHaveBeenCalledWith('/todos/7', { method: 'DELETE' })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})
