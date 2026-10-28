import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import {
  formatDate,
  isOverdue,
  selectTodos,
  toLocalDateString,
  validateTodo,
} from './todos'

const input = {
  title: 'Task',
  description: '',
  priority: 'medium' as const,
  due_date: null,
  completed: false,
}

describe('validateTodo', () => {
  it('accepts valid input', () => {
    expect(validateTodo({ ...input, due_date: '2026-10-15' })).toEqual({})
  })

  it('rejects empty and too long titles', () => {
    expect(validateTodo({ ...input, title: '  ' }).title).toBe(
      'Enter a task title.',
    )
    expect(validateTodo({ ...input, title: 'a'.repeat(121) }).title).toMatch(
      /120/,
    )
  })

  it('rejects long descriptions', () => {
    expect(
      validateTodo({ ...input, description: 'a'.repeat(2001) }).description,
    ).toMatch(/2000/)
  })

  it.each(['2026-13-01', '2026-02-30', '15/10/2026', '2026-1-1'])(
    'rejects invalid date %s',
    (due_date) => {
      expect(validateTodo({ ...input, due_date }).due_date).toBe(
        'Enter a valid date.',
      )
    },
  )
})

describe('selectTodos', () => {
  const a = {
    ...todoFixture,
    id: 1,
    title: 'Alpha',
    priority: 'low' as const,
    created_at: '2026-10-01T00:00:00Z',
    due_date: '2026-11-01',
  }
  const b = {
    ...todoFixture,
    id: 2,
    title: 'Beta',
    description: 'findme',
    priority: 'high' as const,
    completed: true,
    created_at: '2026-10-02T00:00:00Z',
    due_date: '2026-10-05',
  }
  const c = {
    ...todoFixture,
    id: 3,
    title: 'Gamma',
    priority: 'high' as const,
    created_at: '2026-10-02T00:00:00Z',
    due_date: null,
  }
  const todos = [a, b, c]
  const ids = (list: Todo[]) => list.map((t) => t.id)

  it('filters by status', () => {
    expect(ids(selectTodos(todos, 'completed', '', 'newest'))).toEqual([2])
    expect(ids(selectTodos(todos, 'active', '', 'newest'))).toEqual([3, 1])
    expect(ids(selectTodos(todos, 'all', '', 'newest'))).toEqual([3, 2, 1])
  })

  it('searches title and description case-insensitively', () => {
    expect(ids(selectTodos(todos, 'all', ' FINDME ', 'newest'))).toEqual([2])
  })

  it('sorts by priority with id tiebreak', () => {
    expect(ids(selectTodos(todos, 'all', '', 'priority'))).toEqual([3, 2, 1])
  })

  it('sorts by due date with undated last', () => {
    expect(ids(selectTodos(todos, 'all', '', 'due'))).toEqual([2, 1, 3])
    const d = { ...c, id: 4 }
    expect(ids(selectTodos([c, d], 'all', '', 'due'))).toEqual([4, 3])
  })
})

describe('isOverdue and formatDate', () => {
  afterEach(() => vi.useRealTimers())

  it('compares due dates against the local day', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    const make = (due_date: string | null, completed = false) => ({
      ...todoFixture,
      due_date,
      completed,
    })
    expect(isOverdue(make('2026-10-14'))).toBe(true)
    expect(isOverdue(make('2026-10-15'))).toBe(false)
    expect(isOverdue(make('2026-10-16'))).toBe(false)
    expect(isOverdue(make(null))).toBe(false)
    expect(isOverdue(make('2026-10-14', true))).toBe(false)
  })

  it('formats the local calendar date with zero padding', () => {
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(toLocalDateString(new Date(2026, 11, 25))).toBe('2026-12-25')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    expect(toLocalDateString()).toBe('2026-10-15')
  })

  it('formats dates', () => {
    expect(formatDate('2026-10-15')).toBe('15 Oct 2026')
  })
})
