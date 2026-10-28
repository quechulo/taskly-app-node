import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
  }) => <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>,
}))

function arrange(
  todo: Parameters<typeof TodoEditor>[0]['todo'],
  opts: {
    create?: ReturnType<typeof vi.fn>
    update?: ReturnType<typeof vi.fn>
    createState?: object
    updateState?: object
    busy?: boolean
  } = {},
) {
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: opts.create ?? vi.fn(),
    ...opts.createState,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: opts.update ?? vi.fn(),
    ...opts.updateState,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todo}
      busy={opts.busy ?? false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  return { onSaved }
}

it('updates an existing task and reports the save', async () => {
  const update = vi.fn().mockResolvedValue(todoFixture)
  const { onSaved } = arrange(todoFixture, { update })
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: todoFixture,
  })
})

it('does not report a save when the mutation fails', async () => {
  const create = vi.fn().mockRejectedValue(new Error('x'))
  const { onSaved } = arrange('new', { create })
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(create).toHaveBeenCalled())
  expect(onSaved).not.toHaveBeenCalled()
})

it('ignores submits while busy', async () => {
  const create = vi.fn()
  const { onSaved } = arrange('new', { create, busy: true })
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})
