import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits description and due date, and clears the due date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'T')
    await user.type(screen.getByLabelText(/Description/), ' details ')
    const due = screen.getByLabelText(/Due date/)
    await user.type(due, '2026-10-15')
    await user.clear(due)
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'details', due_date: null }),
    )
    await user.type(due, '2026-10-15')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ due_date: '2026-10-15' }),
    )
  })

  it('shows an error alert, busy state, and cancels', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <TodoForm
        onSubmit={vi.fn()}
        onCancel={onCancel}
        busy={false}
        error="Server said no"
      />,
    )
    expect(screen.getByTestId('alert')).toHaveTextContent('Server said no')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(
      <TodoForm onSubmit={vi.fn()} onCancel={onCancel} busy error={null} />,
    )
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  })

  it('prefills values from initial', () => {
    render(
      <TodoForm
        initial={{
          title: 'Existing',
          description: 'd',
          priority: 'low',
          due_date: '2026-10-15',
          completed: false,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    expect(screen.getByLabelText(/Task title/)).toHaveValue('Existing')
    expect(screen.getByLabelText(/Due date/)).toHaveValue('2026-10-15')
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })
})
