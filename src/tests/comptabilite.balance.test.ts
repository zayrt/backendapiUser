import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({ $queryRaw: vi.fn() }))

vi.mock('../lib/prisma.ts', () => ({ prisma }))

import request from 'supertest'
import app from '../app.ts'
import { getBalance } from '../services/balance.service.ts'
import { authenticatedAgent } from './helpers/auth.ts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getBalance', () => {
  it('renvoie une ligne par compte avec son solde, le total général et l’équilibre', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { compte: '411001', debit: '1200.00', credit: '1200.00' },
      { compte: '411002', debit: '600.00', credit: '400.00' },
      { compte: '445710', debit: '0.00', credit: '300.00' },
      { compte: '512000', debit: '1600.00', credit: '0.00' },
      { compte: '706000', debit: '0.00', credit: '1500.00' },
    ])

    await expect(getBalance()).resolves.toEqual({
      comptes: [
        { compte: '411001', debit: '1200.00', credit: '1200.00', solde: '0.00' },
        { compte: '411002', debit: '600.00', credit: '400.00', solde: '200.00' },
        { compte: '445710', debit: '0.00', credit: '300.00', solde: '-300.00' },
        { compte: '512000', debit: '1600.00', credit: '0.00', solde: '1600.00' },
        { compte: '706000', debit: '0.00', credit: '1500.00', solde: '-1500.00' },
      ],
      totaux: { debit: '3400.00', credit: '3400.00', solde: '0.00' },
      equilibree: true,
    })
  })

  it('détecte un déséquilibre d’un centime sans erreur d’arrondi', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { compte: '512000', debit: '0.10', credit: '0.00' },
      { compte: '512100', debit: '0.20', credit: '0.00' },
      { compte: '411001', debit: '0.00', credit: '0.30' },
      { compte: '411002', debit: '9999999999.99', credit: '9999999999.98' },
    ])

    const balance = await getBalance()

    expect(balance.totaux).toEqual({ debit: '10000000000.29', credit: '10000000000.28', solde: '0.01' })
    expect(balance.equilibree).toBe(false)
  })

  it('renvoie une balance vide et équilibrée sans écriture', async () => {
    prisma.$queryRaw.mockResolvedValue([])

    await expect(getBalance()).resolves.toEqual({
      comptes: [],
      totaux: { debit: '0.00', credit: '0.00', solde: '0.00' },
      equilibree: true,
    })
  })
})

describe('GET /api/comptabilite/balance', () => {
  it('exige une session', async () => {
    expect((await request(app).get('/api/comptabilite/balance')).status).toBe(401)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('renvoie la balance dans data', async () => {
    prisma.$queryRaw.mockResolvedValue([{ compte: '512000', debit: '10.00', credit: '0.00' }])

    const response = await authenticatedAgent(app).get('/api/comptabilite/balance')

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ equilibree: false, totaux: { solde: '10.00' } })
  })
})
