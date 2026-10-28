import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: () => <p>Empty task list</p>,
}))
vi.mock('./TodoItem', () => ({
  TodoItem: (props: {
    todo: { title: string }
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      {props.todo.title}
      <button onClick={props.onToggle}>toggle</button>
      <button onClick={props.onEdit}>edit</button>
      <button onClick={props.onDelete}>delete</button>
    </li>
  ),
}))

const props = {
  todos: [],
  hasTodos: false,
  failed: false,
  busy: false,
  onCreate: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

it('shows loading feedback before showing an empty list', () => {
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('shows an unavailable message when loading failed with no tasks', () => {
  render(<TodoList {...props} loading={false} failed />)
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
})

it('keeps showing tasks when a refetch failed but data exists', () => {
  render(
    <TodoList
      {...props}
      loading={false}
      failed
      hasTodos
      todos={[todoFixture]}
    />,
  )
  expect(screen.getByText(todoFixture.title)).toBeVisible()
})

it('wires item callbacks to the task', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoList
      {...props}
      loading={false}
      hasTodos
      todos={[todoFixture]}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'toggle' }))
  await user.click(screen.getByRole('button', { name: 'edit' }))
  await user.click(screen.getByRole('button', { name: 'delete' }))
  expect(onToggle).toHaveBeenCalledWith(todoFixture)
  expect(onEdit).toHaveBeenCalledWith(todoFixture)
  expect(onDelete).toHaveBeenCalledWith(todoFixture)
})
