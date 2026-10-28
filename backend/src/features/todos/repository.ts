import { fromModel } from './mappers.js';
import type { Database, Priority, TodoStats, TodoStore, TodoCreate, TodoUpdate, Todo } from './types.js';

export class TodoRepository implements TodoStore {
  constructor(private readonly database: Pick<Database, 'todo'>) {}

  async list(): Promise<Todo[]> {
    const rows = await this.database.todo.findMany({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
    return rows.map(fromModel);
  }

  async stats(today: string): Promise<TodoStats> {
    const [groups, overdue] = await Promise.all([
      this.database.todo.groupBy({ by: ['priority', 'completed'], _count: { _all: true } }),
      this.database.todo.count({ where: { completed: false, due_date: { lt: new Date(`${today}T00:00:00.000Z`) } } }),
    ]);
    const stats: TodoStats = { total: 0, active: 0, completed: 0, overdue, by_priority: { low: 0, medium: 0, high: 0 } };
    for (const group of groups) {
      const count = group._count._all;
      stats.total += count;
      if (group.completed) stats.completed += count;
      else stats.active += count;
      if (group.priority in stats.by_priority) stats.by_priority[group.priority as Priority] += count;
    }
    return stats;
  }

  async get(id: number): Promise<Todo | null> {
    const record = await this.database.todo.findUnique({ where: { id } });
    return record ? fromModel(record) : null;
  }

  async create(payload: TodoCreate): Promise<Todo> {
    const now = new Date();
    const record = await this.database.todo.create({
      data: {
        ...payload,
        due_date: payload.due_date ? new Date(`${payload.due_date}T00:00:00.000Z`) : null,
        created_at: now,
        updated_at: now,
      },
    });
    return fromModel(record);
  }

  async update(id: number, payload: TodoUpdate): Promise<Todo | null> {
    const allowed = ['title', 'description', 'priority', 'due_date', 'completed'];
    const entries = Object.entries(payload);
    if (!entries.length || entries.some(([key]) => !allowed.includes(key))) {
      throw new Error('Invalid update fields.');
    }
    const rows = await this.database.todo.updateManyAndReturn({
      where: { id },
      data: {
        ...payload,
        due_date: payload.due_date ? new Date(`${payload.due_date}T00:00:00.000Z`) : payload.due_date,
        updated_at: new Date(),
      },
    });
    return rows.length ? fromModel(rows[0]) : null;
  }

  async delete(id: number): Promise<boolean> {
    const { count } = await this.database.todo.deleteMany({ where: { id } });
    return count > 0;
  }
}
