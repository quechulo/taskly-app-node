import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import { createDatabase, initialize } from '../src/core/database.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

describe('createApp', () => {
  it('reports health', async () => {
    const { app, database } = setup();
    const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
  });

  it('returns 500 and logs when the database fails', async () => {
    const { app, database } = setup();
    const error = new Error('Database unavailable');
    vi.spyOn(database.todo, 'findFirst').mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: 'Internal Server Error' });
    expect(log).toHaveBeenCalledWith(error);
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(setup().app).get('/nope');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Not Found' });
  });

  it('returns 422 for malformed JSON', async () => {
    const response = await request(setup().app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  });

  it('returns 413 for oversized bodies', async () => {
    const response = await request(setup().app).post('/api/todos').send({ title: 'x'.repeat(200_000) });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ detail: 'Request body too large.' });
  });

  it('serves the OpenAPI specification and hides x-powered-by', async () => {
    const response = await request(setup().app).get('/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('openapi');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('initialize', () => {
  it('creates the todos table', async () => {
    const { database } = setup();
    const execute = vi.spyOn(database, '$executeRaw').mockResolvedValue(0);
    await initialize(database);
    const strings = execute.mock.calls[0][0] as unknown as TemplateStringsArray;
    expect(strings.join('')).toContain('CREATE TABLE IF NOT EXISTS todos');
  });
});
