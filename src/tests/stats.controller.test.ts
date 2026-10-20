import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const statsService = vi.hoisted(() => ({
  getUsersGrowth: vi.fn(),
  getUsersSummary: vi.fn(),
  parseStatsPeriod: vi.fn((value: unknown) => {
    if (value === undefined) return 7
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= 365) {
      return Number(value)
    }
    throw Object.assign(new Error('days invalide'), { statusCode: 400 })
  }),
  usersGrowthTimezone: 'Europe/Paris',
}))

vi.mock('../services/stats.service.ts', () => statsService)
vi.mock('../services/user.service.ts', () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getUserById: vi.fn(),
  getUsers: vi.fn(),
  updateUser: vi.fn(),
}))

import app from '../app.ts'
import { getUsersGrowth, getUsersSummary } from '../services/stats.service.ts'

const points = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-10-${String(index + 14).padStart(2, '0')}`,
  total: index < 4 ? 0 : 99,
  created: index === 4 ? 99 : 0,
  updated: 0,
  deleted: 0,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUsersGrowth).mockResolvedValue(points)
  vi.mocked(getUsersSummary).mockResolvedValue({ totalUsers: 99, modifiedUsers: 2, deletedUsers: 1 })
})

describe('GET /api/stats/users-growth', () => {
  it('conserve le format et renvoie sept séries journalières', async () => {
    const response = await request(app).get('/api/stats/users-growth?days=7')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ period: 7, timezone: 'Europe/Paris', data: points })
    expect(getUsersGrowth).toHaveBeenCalledWith(7)
  })

  it('rejette une période invalide avec HTTP 400', async () => {
    const response = await request(app).get('/api/stats/users-growth?days=0')

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('days invalide')
    expect(getUsersGrowth).not.toHaveBeenCalled()
  })
})

describe('GET /api/stats/users-summary', () => {
  it('retourne les trois statistiques et la période demandée', async () => {
    const response = await request(app).get('/api/stats/users-summary?days=7')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ totalUsers: 99, modifiedUsers: 2, deletedUsers: 1, period: 7 })
    expect(getUsersSummary).toHaveBeenCalledWith(7)
  })
})
