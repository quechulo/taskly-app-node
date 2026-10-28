import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodoEmptyState } from './TodoEmptyState'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('invites creating the first task and calls onCreate', async () => {
  const onCreate = vi.fn()
  render(
    <TodoEmptyState hasTodos={false} disabled={false} onCreate={onCreate} />,
  )
  expect(
    screen.getByRole('heading', { name: 'Add your first task' }),
  ).toBeVisible()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: /Add your first task/ }))
  expect(onCreate).toHaveBeenCalledOnce()
})

it('disables the button when disabled', () => {
  render(<TodoEmptyState hasTodos={false} disabled onCreate={vi.fn()} />)
  expect(screen.getByRole('button')).toBeDisabled()
})

it('shows a no-match message without a button when todos exist', () => {
  render(<TodoEmptyState hasTodos disabled={false} onCreate={vi.fn()} />)
  expect(
    screen.getByRole('heading', { name: 'No matching tasks' }),
  ).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
