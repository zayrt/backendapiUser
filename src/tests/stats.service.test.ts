import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn() },
}))

vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))

import { getUsersGrowth, getUsersSummary, parseStatsPeriod } from '../services/stats.service.ts'

const growthPoints = [
  { date: '2026-10-14', total: 0, created: 0, updated: 0, deleted: 0 },
  { date: '2026-10-15', total: 0, created: 0, updated: 0, deleted: 0 },
  { date: '2026-10-16', total: 0, created: 0, updated: 0, deleted: 0 },
  { date: '2026-10-17', total: 0, created: 0, updated: 0, deleted: 0 },
  { date: '2026-10-18', total: 99, created: 99, updated: 0, deleted: 0 },
  { date: '2026-10-19', total: 99, created: 0, updated: 0, deleted: 0 },
  { date: '2026-10-20', total: 99, created: 0, updated: 0, deleted: 0 },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stats.service', () => {
  it('retourne sept dates chronologiques avec zéros pour les jours sans activité', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue(growthPoints)

    const result = await getUsersGrowth(7)

    expect(result).toEqual(growthPoints)
    expect(result).toHaveLength(7)
    expect(result[4]).toMatchObject({ created: 99, total: 99 })
    expect(result[0]).toMatchObject({ created: 0, updated: 0, deleted: 0, total: 0 })
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledOnce()
  })

  it('retourne sept points à zéro pour une base vide', async () => {
    const emptyPeriod = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(index + 14).padStart(2, '0')}`,
      total: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    }))
    mocks.prisma.$queryRaw.mockResolvedValue(emptyPeriod)

    await expect(getUsersGrowth(7)).resolves.toEqual(emptyPeriod)
  })

  it('utilise une seule requête SQL paramétrée pour les événements et le total', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue(growthPoints)

    await getUsersGrowth(7)

    const sql = mocks.prisma.$queryRaw.mock.calls[0][0].join(' ')
    expect(sql).toContain('Europe/Paris')
    expect(sql).toContain('UserAuditLog')
    expect(sql).toContain("'CREATE'")
    expect(sql).toContain("'UPDATE'")
    expect(sql).toContain("'DELETE'")
    expect(sql).toContain('DISTINCT')
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('MIN(audit.')
    expect(sql).toContain('future_created')
    expect(sql).toContain('future_deleted')
    expect(sql).toContain('createdAt')
  })

  it('conserve des dates chronologiques à cheval sur année et changement d’heure', async () => {
    const boundaryDates = [
      '2025-12-31', '2026-01-01', '2026-03-28', '2026-03-29', '2026-03-30',
    ].map((date) => ({ date, total: 0, created: 0, updated: 0, deleted: 0 }))
    mocks.prisma.$queryRaw.mockResolvedValue(boundaryDates)

    await expect(getUsersGrowth(365)).resolves.toEqual(boundaryDates)
    const sql = mocks.prisma.$queryRaw.mock.calls[0][0].join(' ')
    expect(sql).toContain("AT TIME ZONE 'Europe/Paris'")
  })

  it('retourne les agrégats résumé depuis un seul appel Prisma', async () => {
    const summary = { totalUsers: 99, modifiedUsers: 2, deletedUsers: 1 }
    mocks.prisma.$queryRaw.mockResolvedValue([summary])

    await expect(getUsersSummary(7)).resolves.toEqual(summary)
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledOnce()
  })

  it('propage les erreurs Prisma sans fabriquer de données', async () => {
    const databaseError = new Error('database unavailable')
    mocks.prisma.$queryRaw.mockRejectedValue(databaseError)

    await expect(getUsersGrowth(7)).rejects.toBe(databaseError)
  })

  it('accepte la période par défaut et refuse une période invalide', () => {
    expect(parseStatsPeriod(undefined)).toBe(7)
    expect(parseStatsPeriod('1')).toBe(1)
    expect(parseStatsPeriod('365')).toBe(365)
    expect(() => parseStatsPeriod('0')).toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() => parseStatsPeriod('366')).toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() => parseStatsPeriod('7.5')).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})
