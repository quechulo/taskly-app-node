import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('shows a message and clears it after 4 seconds', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  act(() => result.current.notify('Saved'))
  expect(result.current.message).toBe('Saved')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Saved')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('restarts the timer on a new notice', () => {
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('One'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Two'))
  act(() => vi.advanceTimersByTime(3000))
  expect(result.current.message).toBe('Two')
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current.message).toBe('')
})
