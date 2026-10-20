import { prisma } from '../lib/prisma.ts'

export interface UserGrowthPoint {
  date: string
  total: number
  created: number
  updated: number
  deleted: number
}

export interface UsersSummary {
  totalUsers: number
  modifiedUsers: number
  deletedUsers: number
}

export const usersGrowthTimezone = 'Europe/Paris'

export function parseStatsPeriod(value: unknown): number {
  if (value === undefined) {
    return 7
  }

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw Object.assign(new Error('days doit être un entier compris entre 1 et 365.'), { statusCode: 400 })
  }

  const days = Number(value)
  if (!Number.isSafeInteger(days) || days > 365) {
    throw Object.assign(new Error('days doit être un entier compris entre 1 et 365.'), { statusCode: 400 })
  }

  return days
}

export async function getUsersGrowth(days: number): Promise<UserGrowthPoint[]> {
  return prisma.$queryRaw<UserGrowthPoint[]>`
    WITH local_dates AS (
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date AS today
    ), bounds AS (
      SELECT
        (today - (${days}::int - 1)) AS first_day,
        today,
        (((today - (${days}::int - 1))::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS start_utc,
        (((today + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS end_utc
      FROM local_dates
    ), date_series AS (
      SELECT generate_series(
        bounds.first_day::timestamp,
        bounds.today::timestamp,
        INTERVAL '1 day'
      )::date AS day
      FROM bounds
    ), current_user_creations AS (
      SELECT
        users.id AS user_id,
        COALESCE(MIN(audit."createdAt"), users."createdAt") AS event_at
      FROM "User" AS users
      CROSS JOIN bounds
      LEFT JOIN "UserAuditLog" AS audit
        ON audit."userId" = users.id
        AND audit.action = 'CREATE'
      GROUP BY users.id, users."createdAt", bounds.start_utc, bounds.end_utc
      HAVING COALESCE(MIN(audit."createdAt"), users."createdAt") >= bounds.start_utc
        AND COALESCE(MIN(audit."createdAt"), users."createdAt") < bounds.end_utc
    ), deleted_user_creations AS (
      SELECT audit."userId" AS user_id, MIN(audit."createdAt") AS event_at
      FROM "UserAuditLog" AS audit
      CROSS JOIN bounds
      WHERE audit.action = 'CREATE'
        AND audit."createdAt" >= bounds.start_utc
        AND audit."createdAt" < bounds.end_utc
        AND NOT EXISTS (
          SELECT 1 FROM "User" AS users WHERE users.id = audit."userId"
        )
      GROUP BY audit."userId"
    ), create_candidates AS (
      SELECT user_id, event_at FROM current_user_creations

      UNION ALL

      SELECT user_id, event_at FROM deleted_user_creations
    ), created_events AS (
      SELECT DISTINCT ON (user_id) user_id, event_at
      FROM create_candidates
      ORDER BY user_id, event_at
    ), audit_events AS (
      SELECT audit."userId" AS user_id, audit.action, audit."createdAt" AS event_at
      FROM "UserAuditLog" AS audit
      CROSS JOIN bounds
      WHERE audit.action IN ('UPDATE', 'DELETE')
        AND audit."createdAt" >= bounds.start_utc
        AND audit."createdAt" < bounds.end_utc
    ), daily_created AS (
      SELECT
        ((event_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date AS day,
        COUNT(DISTINCT user_id)::int AS created
      FROM created_events
      GROUP BY 1
    ), daily_updated AS (
      SELECT
        ((event_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date AS day,
        COUNT(DISTINCT user_id)::int AS updated
      FROM audit_events
      WHERE action = 'UPDATE'
      GROUP BY 1
    ), daily_deleted AS (
      SELECT
        ((event_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date AS day,
        COUNT(DISTINCT user_id)::int AS deleted
      FROM audit_events
      WHERE action = 'DELETE'
      GROUP BY 1
    ), daily_activity AS (
      SELECT
        date_series.day,
        COALESCE(daily_created.created, 0)::int AS created,
        COALESCE(daily_updated.updated, 0)::int AS updated,
        COALESCE(daily_deleted.deleted, 0)::int AS deleted
      FROM date_series
      LEFT JOIN daily_created ON daily_created.day = date_series.day
      LEFT JOIN daily_updated ON daily_updated.day = date_series.day
      LEFT JOIN daily_deleted ON daily_deleted.day = date_series.day
    ), activity_with_future AS (
      SELECT
        daily_activity.*,
        COALESCE(SUM(created) OVER (
          ORDER BY day ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
        ), 0)::int AS future_created,
        COALESCE(SUM(deleted) OVER (
          ORDER BY day ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
        ), 0)::int AS future_deleted
      FROM daily_activity
    ), current_total AS (
      SELECT COUNT(*)::int AS total FROM "User"
    )
    SELECT
      to_char(activity.day, 'YYYY-MM-DD') AS date,
      (current_total.total - activity.future_created + activity.future_deleted)::int AS total,
      activity.created,
      activity.updated,
      activity.deleted
    FROM activity_with_future AS activity
    CROSS JOIN current_total
    ORDER BY activity.day
  `
}

export async function getUsersSummary(days: number): Promise<UsersSummary> {
  const [summary] = await prisma.$queryRaw<UsersSummary[]>`
    WITH local_dates AS (
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date AS today
    ), bounds AS (
      SELECT
        (((today - (${days}::int - 1))::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS start_utc,
        (((today + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS end_utc
      FROM local_dates
    )
    SELECT
      (SELECT COUNT(*)::int FROM "User") AS "totalUsers",
      (
        SELECT COUNT(DISTINCT log."userId")::int
        FROM "UserAuditLog" AS log
        CROSS JOIN bounds
        WHERE log.action = 'UPDATE'
          AND log."createdAt" >= bounds.start_utc
          AND log."createdAt" < bounds.end_utc
      ) AS "modifiedUsers",
      (
        SELECT COUNT(DISTINCT log."userId")::int
        FROM "UserAuditLog" AS log
        CROSS JOIN bounds
        WHERE log.action = 'DELETE'
          AND log."createdAt" >= bounds.start_utc
          AND log."createdAt" < bounds.end_utc
      ) AS "deletedUsers"
  `

  return summary
}