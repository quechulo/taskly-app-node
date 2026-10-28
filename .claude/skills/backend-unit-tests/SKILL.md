---
name: backend-unit-tests
description: Conventions and patterns for unit tests of the Taskly backend (Express 5, Prisma 7, zod, Vitest, Supertest), including how to mock Prisma without a database, test routers and the app factory with Supertest, and stub environment and process APIs. Use before writing or updating any file in backend/tests.
---

# Backend unit tests

## Layout and style

- Tests live in `backend/tests/<module>.test.ts`. That's a flat folder named after the source file, e.g. `src/core/config.ts` becomes `tests/config.test.ts`. Vitest only picks up `tests/**/*.test.ts`.
- Import source with the **`.ts` extension** and a relative path: `import { createTodosRouter } from '../src/features/todos/router.ts';`. Inside `src/` the code uses `.js` specifiers, and Vitest resolves both to the same module.
- Import test APIs explicitly: `import { describe, it, expect, vi, afterEach } from 'vitest';`. There are no globals in the backend.
- Match the existing style: semicolons, single quotes, short `it(...)` blocks. Use `describe` only to group related cases. Use `it.each` for tables of inputs, as `tests/validators.test.ts` does.
- Shared data is in `tests/fixture.ts`:
  - `record` is a Prisma `TodoRecord` with `Date` fields.
  - `todo` is the API JSON shape.

  Spread them for variants (`{ ...record, completed: true }`). Add new shared data to `fixture.ts` (or a new `tests/fixture.<topic>.ts`) only when two or more test files need it.
- `npm run typecheck` includes `tests/`, so tests must type-check under `strict`.

## No database

Unit tests never need PostgreSQL. Build the real Prisma client and stub its delegate methods. Constructing it doesn't open a connection:

```ts
import { createDatabase } from '../src/core/database.ts';

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, repository: new TodoRepository(database) };
}

const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
expect(findMany).toHaveBeenCalledWith({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
```

- **Raw SQL** (`database.$executeRaw`) is a tagged template: `vi.spyOn(database, '$executeRaw').mockResolvedValue(0)`. Then assert on `mock.calls[0][0]`, which holds the template strings, e.g. `expect(calls[0][0].join('')).toContain('CREATE TABLE IF NOT EXISTS todos')`.
- **Aggregations** (`count`, `groupBy`, `aggregate`): stub them the same way and return the exact shape Prisma returns, e.g. `[{ priority: 'high', _count: { _all: 2 } }]`. Assert the `where`/`by` arguments, because they are the query logic.
- **Error propagation:** `.mockRejectedValue(new Error('Database unavailable'))`, then `await expect(...).rejects.toThrow(...)`.
- Call `afterEach(() => vi.restoreAllMocks())` whenever you spy.

## Routers: Supertest against a fake store

Routers depend on the `TodoStore` interface, not Prisma. Give them a fake that has **every** method of the interface. When the interface gains a method, add it to the fake in `tests/router.test.ts` too.

```ts
function setup() {
  const repository = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

const response = await request(app).patch('/api/todos/1').send({ completed: true });
expect(response.status).toBe(200);
expect(repository.update).toHaveBeenCalledWith(1, { completed: true });
```

For every route, cover:
- the success status and body;
- `422` for an invalid body or `:id` (the repository must **not** be called);
- `404` when the store returns `null`/`false`;
- the exact arguments passed to the store, including parsed and trimmed values and defaults.

Route order matters: a static path such as `/stats` must be registered before `/:id`. Otherwise `router.param('id')` answers `422`. A test that requests the static path catches this.

## App factory, health and error handling

`createApp(database)` wires everything. Test it with Supertest and a stubbed Prisma client:
- **`GET /api/health`:** stub `database.todo.findFirst`. Cover `200 { status: 'ok' }`, and `500` when it rejects.
- **Unknown route:** `404 { detail: 'Not Found' }`.
- **Malformed JSON:** `.set('Content-Type', 'application/json').send('{"title":')` gives `422 { detail: 'Invalid JSON.' }`.
- **Body over Express's 100kb default:** gives `413`.
- **Unexpected errors:** make a delegate reject, which gives `500 { detail: 'Internal Server Error' }`. Silence and assert the log with `vi.spyOn(console, 'error').mockImplementation(() => {})`.
- **`GET /openapi.json`:** returns the specification.

## Configuration and environment

`src/core/config.ts` runs `dotenv.config()` for the repository-root `.env` **when imported**. Developer machines may have real values there. So:
- Use `vi.stubEnv(name, value)` for every variable the test depends on, including `vi.stubEnv('DATABASE_URL', '')` to disable the override. Call `vi.unstubAllEnvs()` in `afterEach`.
- Assert the URL is built correctly: credentials and database name encoded, and the `postgresql+psycopg:` prefix normalised. Also assert that the missing-variable error names the variable.

## Process-level code (`lifespan.ts`, `main.ts`)

- Mock collaborators with `vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }))` and `vi.mock('../src/factory.ts', ...)`. Use `vi.hoisted` for shared mock objects.
- **Signal handlers:** never register real ones. Capture them with `const once = vi.spyOn(process, 'once').mockImplementation(() => process)`, take the handler from `once.mock.calls`, and invoke it.
- **Exit codes:** save and restore `process.exitCode`. Stub `process.exit` with `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`.
- **Listening servers:** fake `app.listen` so it returns an `EventEmitter`-like object, so no real port is bound. If a real server is unavoidable, listen on port `0` and close it in `afterEach`.
- **Entry modules that run on import** (`main.ts`): `vi.resetModules()`, then `await import('../src/main.ts')` inside the test, after the mocks are configured.

## Checklist before running

- Every new route, branch and error path from the diff has a test.
- Every fake implements the full interface.
- No real network, database or port, and no dependency on `.env` contents.
- Fixtures were reused, not duplicated.
