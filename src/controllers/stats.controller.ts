import type { RequestHandler } from 'express'
import {
  getUsersGrowth,
  getUsersSummary,
  parseStatsPeriod,
  usersGrowthTimezone,
} from '../services/stats.service.ts'

export const getUsersGrowthStats: RequestHandler = async (req, res) => {
  const period = parseStatsPeriod(req.query.days)
  const data = await getUsersGrowth(period)

  res.json({ period, timezone: usersGrowthTimezone, data })
}

export const getUsersSummaryStats: RequestHandler = async (req, res) => {
  const period = parseStatsPeriod(req.query.days)
  const summary = await getUsersSummary(period)

  res.json({ ...summary, period })
}