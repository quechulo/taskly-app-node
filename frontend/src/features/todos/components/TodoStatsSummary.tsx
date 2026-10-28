import { Badge, Card, Text } from '../../../design-system'
import type { TodoStats } from '../types'
import { priorityLabels } from '../utils/todos'

export function TodoStatsSummary({
  stats,
  loading,
}: {
  stats: TodoStats | undefined
  loading: boolean
}) {
  if (loading || !stats) {
    return (
      <Card aria-label="Task statistics">
        <Text muted role="status">
          Loading statistics…
        </Text>
      </Card>
    )
  }
  if (stats.total === 0) return null
  const percent = Math.round((stats.completed / stats.total) * 100)
  return (
    <Card aria-label="All tasks statistics">
      <div className="row spread">
        <Text>
          {stats.completed} of {stats.total} tasks completed ({percent}%)
        </Text>
        <div className="row compact">
          <Badge variant="info">{stats.active} to do</Badge>
          {stats.overdue > 0 && (
            <Badge variant="warning">{stats.overdue} overdue</Badge>
          )}
        </div>
      </div>
      <Text as="span" muted size="small">
        {(['high', 'medium', 'low'] as const)
          .map(
            (priority) =>
              `${priorityLabels[priority]}: ${stats.by_priority[priority]}`,
          )
          .join(' · ')}
      </Text>
    </Card>
  )
}
