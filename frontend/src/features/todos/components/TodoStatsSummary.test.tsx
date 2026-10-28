import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TodoStats } from '../types'
import { TodoStatsSummary } from './TodoStatsSummary'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

const stats: TodoStats = {
  total: 3,
  active: 2,
  completed: 1,
  overdue: 1,
  by_priority: { low: 1, medium: 0, high: 2 },
}

describe('TodoStatsSummary', () => {
  it('shows a loading status while loading', () => {
    render(<TodoStatsSummary stats={stats} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading statistics…')
    expect(screen.getByLabelText('Task statistics')).toBeInTheDocument()
  })

  it('shows loading when stats are missing', () => {
    render(<TodoStatsSummary stats={undefined} loading={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders nothing when there are no tasks', () => {
    const { container } = render(
      <TodoStatsSummary
        stats={{ ...stats, total: 0, active: 0, completed: 0, overdue: 0 }}
        loading={false}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('summarises progress, overdue and priorities', () => {
    render(<TodoStatsSummary stats={stats} loading={false} />)
    expect(screen.getByLabelText('All tasks statistics')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 tasks completed (33%)')).toBeVisible()
    expect(screen.getByText('2 to do')).toBeVisible()
    expect(screen.getByText('1 overdue')).toBeVisible()
    expect(screen.getByText('High: 2 · Medium: 0 · Low: 1')).toBeVisible()
  })

  it('hides the overdue badge when nothing is overdue', () => {
    render(
      <TodoStatsSummary stats={{ ...stats, overdue: 0 }} loading={false} />,
    )
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })
})
