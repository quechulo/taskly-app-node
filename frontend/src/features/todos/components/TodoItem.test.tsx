import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

const handlers = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }

describe('TodoItem variants', () => {
  afterEach(() => vi.useRealTimers())

  it('shows a completed task with description and handles toggle/delete', async () => {
    const user = userEvent.setup()
    const todo = {
      ...todoFixture,
      completed: true,
      description: 'Some notes',
      priority: 'high' as const,
    }
    render(<TodoItem todo={todo} busy={false} {...handlers} />)
    expect(screen.getByText('Some notes')).toBeVisible()
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByText('High')).toBeVisible()
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.click(
      screen.getByRole('checkbox', { name: `Mark as active: ${todo.title}` }),
    )
    expect(handlers.onToggle).toHaveBeenCalledTimes(1)
    await user.click(
      screen.getByRole('button', { name: `Delete: ${todo.title}` }),
    )
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })

  it('disables all controls while busy', () => {
    render(<TodoItem todo={todoFixture} busy {...handlers} />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Edit:/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete:/ })).toBeDisabled()
  })

  it('flags overdue tasks and not future ones', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    const { rerender } = render(
      <TodoItem
        todo={{ ...todoFixture, due_date: '2026-10-14' }}
        busy={false}
        {...handlers}
      />,
    )
    expect(screen.getByText(/14 Oct 2026/)).toHaveTextContent('· overdue')
    rerender(
      <TodoItem
        todo={{ ...todoFixture, due_date: '2026-10-16' }}
        busy={false}
        {...handlers}
      />,
    )
    expect(screen.getByText(/16 Oct 2026/)).not.toHaveTextContent('overdue')
  })
})

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})
