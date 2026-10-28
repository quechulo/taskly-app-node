import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

it('derives visible todos from filter, search and sort state', () => {
  const done = { ...todoFixture, id: 1, title: 'Done', completed: true }
  const open = { ...todoFixture, id: 2, title: 'Open' }
  const { result } = renderHook(() => useTodoFilters([done, open]))
  expect(result.current).toMatchObject({
    filter: 'all',
    search: '',
    sort: 'newest',
  })
  expect(result.current.visible).toHaveLength(2)
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])
  act(() => result.current.setFilter('all'))
  act(() => result.current.setSearch('open'))
  expect(result.current.visible).toEqual([open])
  act(() => result.current.setSort('due'))
  expect(result.current.sort).toBe('due')
})
