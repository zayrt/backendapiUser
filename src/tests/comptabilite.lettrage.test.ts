import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    ecriture: { updateMany: vi.fn() },
  }

  return {
    transaction,
    prisma: {
      ecriture: { findMany: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))

import request from 'supertest'
import app from '../app.ts'
import { delettrer, getEcrituresCompte, lettrer, nextLettrageCode } from '../services/lettrage.service.ts'
import { authenticatedAgent } from './helpers/auth.ts'

const facture = { id: 1, compte: '411001', debit: '1200.00', credit: '0.00', lettrage: null }
const acompte = { id: 2, compte: '411001', debit: '0.00', credit: '400.00', lettrage: null }
const solde = { id: 3, compte: '411001', debit: '0.00', credit: '800.00', lettrage: null }

// Premier $queryRaw : lignes verrouillées ; second : codes déjà utilisés sur le compte.
function givenLines(lines: object[], existingCodes: string[] = []) {
  mocks.transaction.$queryRaw
    .mockResolvedValueOnce(lines)
    .mockResolvedValueOnce(existingCodes.map((code) => ({ code })))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.$queryRaw.mockReset()
  mocks.prisma.$transaction.mockImplementation(
    (operations: (transaction: typeof mocks.transaction) => Promise<unknown>) => operations(mocks.transaction),
  )
  mocks.transaction.ecriture.updateMany.mockResolvedValue({ count: 3 })
})

describe('nextLettrageCode', () => {
  it.each([
    [[], 'A'],
    [['A'], 'B'],
    [['A', 'C', 'B'], 'D'],
    [['Z'], 'AA'],
    [['Z', 'AA', 'B'], 'AB'],
    [['AZ'], 'BA'],
    [['ZZ', 'Y'], 'AAA'],
  ])('%o → %s', (existing, expected) => {
    expect(nextLettrageCode(existing)).toBe(expected)
  })
})

describe('lettrer', () => {
  it('attribue le code suivant aux lignes d’un même compte dont la somme est nulle', async () => {
    givenLines([facture, acompte, solde], ['A', 'B'])

    await expect(lettrer({ ecritureIds: [3, 1, 2, 2] })).resolves.toEqual({
      compte: '411001',
      code: 'C',
      ecritureIds: [1, 2, 3],
    })
    expect(mocks.transaction.$executeRaw).toHaveBeenCalledOnce()
    expect(mocks.transaction.ecriture.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
      data: { lettrage: 'C' },
    })
  })

  it('refuse une sélection dont la somme n’est pas nulle', async () => {
    givenLines([facture, acompte])

    await expect(lettrer({ ecritureIds: [1, 2] })).rejects.toMatchObject({
      statusCode: 400,
      message: 'La somme des écritures sélectionnées doit être nulle (écart 800,00).',
    })
    expect(mocks.transaction.ecriture.updateMany).not.toHaveBeenCalled()
  })

  it('refuse des lignes de comptes différents', async () => {
    givenLines([facture, { ...acompte, compte: '411002', credit: '1200.00' }])

    await expect(lettrer({ ecritureIds: [1, 2] })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuse un compte autre que 411 ou 512', async () => {
    givenLines([{ ...facture, compte: '706000' }, { ...acompte, compte: '706000', credit: '1200.00' }])

    await expect(lettrer({ ecritureIds: [1, 2] })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Seuls les comptes 411 (clients) et 512 (banque) peuvent être lettrés.',
    })
  })

  it('accepte le compte de banque 512', async () => {
    givenLines([
      { id: 4, compte: '512000', debit: '360.00', credit: '0.00', lettrage: null },
      { id: 5, compte: '512000', debit: '0.00', credit: '360.00', lettrage: null },
    ])

    await expect(lettrer({ ecritureIds: [4, 5] })).resolves.toMatchObject({ compte: '512000', code: 'A' })
  })

  it('refuse une ligne déjà lettrée (409) ou introuvable (404)', async () => {
    givenLines([facture, { ...acompte, credit: '1200.00', lettrage: 'A' }])
    await expect(lettrer({ ecritureIds: [1, 2] })).rejects.toMatchObject({ statusCode: 409 })

    givenLines([facture])
    await expect(lettrer({ ecritureIds: [1, 99] })).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([
    [undefined],
    [{}],
    [{ ecritureIds: [1] }],
    [{ ecritureIds: [1, 1] }],
    [{ ecritureIds: [1, 'x'] }],
    [{ ecritureIds: [1, 2.5] }],
    [{ ecritureIds: [0, 1] }],
    [{ ecritureIds: Array.from({ length: 201 }, (_, index) => index + 1) }],
  ])('valide la sélection %#', async (payload) => {
    await expect(lettrer(payload)).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('delettrer', () => {
  it('retire le code de toutes les lignes du lettrage', async () => {
    mocks.prisma.ecriture.updateMany.mockResolvedValue({ count: 2 })

    await expect(delettrer('411001', 'b')).resolves.toBeUndefined()
    expect(mocks.prisma.ecriture.updateMany).toHaveBeenCalledWith({
      where: { compte: '411001', lettrage: 'B' },
      data: { lettrage: null },
    })
  })

  it('répond 404 pour un lettrage inexistant et 400 pour un code ou un compte invalide', async () => {
    mocks.prisma.ecriture.updateMany.mockResolvedValue({ count: 0 })

    await expect(delettrer('411001', 'Z')).rejects.toMatchObject({ statusCode: 404 })
    await expect(delettrer('411001', 'A1')).rejects.toMatchObject({ statusCode: 400 })
    await expect(delettrer('706000', 'A')).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('getEcrituresCompte', () => {
  it('formate dates et montants en texte', async () => {
    mocks.prisma.ecriture.findMany.mockResolvedValue([{
      id: 1,
      date: new Date('2026-09-02T00:00:00.000Z'),
      journal: 'VT',
      piece: 'F1',
      compte: '411001',
      libelle: 'Facture',
      debit: { toFixed: () => '1200.00' },
      credit: { toFixed: () => '0.00' },
      lettrage: 'A',
    }])

    await expect(getEcrituresCompte('411001')).resolves.toEqual([{
      id: 1,
      date: '2026-09-02',
      journal: 'VT',
      piece: 'F1',
      compte: '411001',
      libelle: 'Facture',
      debit: '1200.00',
      credit: '0.00',
      lettrage: 'A',
    }])
    expect(mocks.prisma.ecriture.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { compte: '411001' } }))
    await expect(getEcrituresCompte('')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('renvoie tout le journal quand aucun compte n’est demandé', async () => {
    mocks.prisma.ecriture.findMany.mockResolvedValue([])

    await expect(getEcrituresCompte(undefined)).resolves.toEqual([])
    expect(mocks.prisma.ecriture.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }))
  })
})

describe('routes de lettrage', () => {
  const api = authenticatedAgent(app)

  it('exigent une session', async () => {
    expect((await request(app).get('/api/comptabilite/ecritures?compte=411001')).status).toBe(401)
    expect((await request(app).post('/api/comptabilite/lettrages').send({ ecritureIds: [1, 2] })).status).toBe(401)
    expect((await request(app).delete('/api/comptabilite/lettrages/411001/A')).status).toBe(401)
  })

  it('POST /lettrages renvoie 201 et DELETE /lettrages/:compte/:code renvoie 204', async () => {
    givenLines([facture, { ...acompte, credit: '1200.00' }])
    mocks.prisma.ecriture.updateMany.mockResolvedValue({ count: 2 })

    const created = await api.post('/api/comptabilite/lettrages').send({ ecritureIds: [1, 2] })
    const removed = await api.delete('/api/comptabilite/lettrages/411001/A')

    expect(created.status).toBe(201)
    expect(created.body.data).toEqual({ compte: '411001', code: 'A', ecritureIds: [1, 2] })
    expect(removed.status).toBe(204)
  })
})
