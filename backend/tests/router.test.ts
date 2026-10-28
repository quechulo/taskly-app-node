import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

const stats = { total: 3, active: 2, completed: 1, overdue: 1, by_priority: { low: 1, medium: 1, high: 1 } };

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), stats: vi.fn().mockResolvedValue(stats), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it('returns stats for the given date before the :id route', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos/stats?today=2026-10-15');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(stats);
  expect(repository.stats).toHaveBeenCalledWith('2026-10-15');
  expect(repository.get).not.toHaveBeenCalled();
});
it('defaults stats date to today in UTC', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-04T23:00:00Z'));
  try {
    const { app, repository } = setup();
    expect((await request(app).get('/api/todos/stats')).status).toBe(200);
    expect(repository.stats).toHaveBeenCalledWith('2026-03-04');
  } finally {
    vi.useRealTimers();
  }
});
it('rejects an invalid stats date', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos/stats?today=nope');
  expect(response.status).toBe(422);
  expect(repository.stats).not.toHaveBeenCalled();
});
it('gets a task by id', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('returns 404 when a task is missing', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  repository.update.mockResolvedValue(null);
  repository.delete.mockResolvedValue(false);
  for (const response of [
    await request(app).get('/api/todos/5'),
    await request(app).patch('/api/todos/5').send({ completed: true }),
    await request(app).delete('/api/todos/5'),
  ]) {
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Task not found.' });
  }
});
it('updates a task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue({ ...todo, completed: true });
  const response = await request(app).patch('/api/todos/1').send({ completed: true });
  expect(response.status).toBe(200);
  expect(response.body.completed).toBe(true);
  expect(repository.update).toHaveBeenCalledWith(1, { completed: true });
});
it('rejects invalid update input', async () => {
  const { app, repository } = setup();
  const response = await request(app).patch('/api/todos/1').send({ title: ' ' });
  expect(response.status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
});
it('deletes a task', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(repository.delete).toHaveBeenCalledWith(1);
});
it.each(['abc', '0', '-1'])('rejects invalid id %s', async (id) => {
  const { app, repository } = setup();
  const response = await request(app).get(`/api/todos/${id}`);
  expect(response.status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
