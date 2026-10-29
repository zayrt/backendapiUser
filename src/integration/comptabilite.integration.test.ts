import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import app from '../app.ts'
import { prisma } from '../lib/prisma.ts'

type Agent = ReturnType<typeof request.agent>

const exemple = readFileSync(new URL('../../exemples/ecritures-exemple.csv', import.meta.url))
let agent: Agent

function upload(content: Buffer, filename = 'ecritures.csv') {
  return agent.post('/api/comptabilite/imports').attach('fichier', content, { filename, contentType: 'text/csv' })
}

async function ecrituresDuCompte(compte: string) {
  const response = await agent.get('/api/comptabilite/ecritures').query({ compte })
  expect(response.status).toBe(200)
  return response.body.data as Array<{ id: number, piece: string, debit: string, credit: string, lettrage: string | null }>
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "User", "UserAuditLog", ecritures, imports_comptables, "Account" RESTART IDENTITY')
  agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({ name: 'Comptable', email: 'compta@example.com', password: 'motdepasse-solide' })
  expect(response.status).toBe(201)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('schéma', () => {
  it('stocke débit et crédit en NUMERIC(12,2)', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string, data_type: string, numeric_precision: number, numeric_scale: number }>>`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'ecritures' AND column_name IN ('debit', 'credit')
      ORDER BY column_name
    `

    expect(columns).toEqual([
      { column_name: 'credit', data_type: 'numeric', numeric_precision: 12, numeric_scale: 2 },
      { column_name: 'debit', data_type: 'numeric', numeric_precision: 12, numeric_scale: 2 },
    ])
  })
})

describe('import CSV', () => {
  it('importe le fichier d’exemple en écartant le doublon et la pièce déséquilibrée', async () => {
    const response = await upload(exemple, 'ecritures-exemple.csv')

    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({
      lignesLues: 20,
      lignesImportees: 15,
      lignesRejetees: 3,
      doublons: 2,
      piecesImportees: 6,
      piecesRejetees: 1,
    })
    expect(response.body.data.erreurs.map((erreur: { ligne: number }) => erreur.ligne)).toEqual([15, 16, 17, 20, 21])

    const [{ count }] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM ecritures WHERE piece = 'F2026-004'
    `
    expect(count).toBe(0)
    expect(await prisma.ecriture.count()).toBe(15)
  })

  it('refuse de réimporter le même fichier', async () => {
    const response = await upload(exemple, 'copie.csv')

    expect(response.status).toBe(409)
    expect(response.body.error.message).toMatch(/^Ce fichier a déjà été importé le /)
  })

  it('n’importe d’un fichier corrigé que les lignes nouvelles', async () => {
    const corrige = Buffer.from(exemple.toString('utf8').replace(';;380,00', ';;400,00'))

    const response = await upload(corrige, 'ecritures-corrigees.csv')

    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({ lignesImportees: 3, doublons: 17, piecesImportees: 1, piecesRejetees: 0 })
    expect(await prisma.ecriture.count()).toBe(18)
  })

  it('gère deux imports simultanés du même fichier sans doublon', async () => {
    const content = Buffer.from([
      'date;journal;piece;compte;libelle;debit;credit',
      '2026-10-01;BQ;E2026-010;512000;Remise chèques;50,00;',
      '2026-10-01;BQ;E2026-010;411002;Remise chèques;;50,00',
    ].join('\n'))

    const statuses = (await Promise.all([upload(content), upload(content)])).map((response) => response.status).sort()

    expect(statuses).toEqual([201, 409])
    expect(await prisma.ecriture.count({ where: { piece: 'E2026-010' } })).toBe(2)
  })

  it('refuse en base une ligne portant à la fois un débit et un crédit', async () => {
    const [{ id }] = await prisma.$queryRaw<Array<{ id: number }>>`SELECT id FROM imports_comptables LIMIT 1`

    await expect(prisma.$executeRaw`
      INSERT INTO ecritures (date, journal, piece, compte, libelle, debit, credit, ligne_hash, import_id)
      VALUES ('2026-10-01', 'OD', 'X', '512000', 'Invalide', 1, 1, ${'f'.repeat(64)}, ${id})
    `).rejects.toThrow()
  })
})

describe('balance', () => {
  it('totalise chaque compte au centime près et indique l’équilibre', async () => {
    const response = await agent.get('/api/comptabilite/balance')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      comptes: [
        { compte: '411001', debit: '3600.00', credit: '1200.00', solde: '2400.00' },
        { compte: '411002', debit: '600.00', credit: '450.00', solde: '150.00' },
        { compte: '411003', debit: '360.00', credit: '360.00', solde: '0.00' },
        { compte: '445710', debit: '0.00', credit: '760.00', solde: '-760.00' },
        { compte: '512000', debit: '2010.00', credit: '0.00', solde: '2010.00' },
        { compte: '706000', debit: '0.00', credit: '3800.00', solde: '-3800.00' },
      ],
      totaux: { debit: '6570.00', credit: '6570.00', solde: '0.00' },
      equilibree: true,
    })
  })
})

describe('lettrage', () => {
  it('lettre une facture et son encaissement, puis refuse de les relettrer', async () => {
    const lignes = await ecrituresDuCompte('411001')
    const ids = lignes.filter((ligne) => ['F2026-001', 'E2026-001'].includes(ligne.piece)).map((ligne) => ligne.id)

    const response = await agent.post('/api/comptabilite/lettrages').send({ ecritureIds: ids })

    expect(response.status).toBe(201)
    expect(response.body.data).toEqual({ compte: '411001', code: 'A', ecritureIds: ids })
    expect((await ecrituresDuCompte('411001')).map((ligne) => ligne.lettrage)).toEqual(['A', 'A', null])
    expect((await agent.post('/api/comptabilite/lettrages').send({ ecritureIds: ids })).status).toBe(409)
  })

  it('numérote les codes par compte', async () => {
    const ids = (await ecrituresDuCompte('411003')).map((ligne) => ligne.id)

    const response = await agent.post('/api/comptabilite/lettrages').send({ ecritureIds: ids })

    expect(response.body.data.code).toBe('A')
  })

  it('refuse une sélection dont la somme n’est pas nulle', async () => {
    const ids = (await ecrituresDuCompte('411002')).map((ligne) => ligne.id)

    const response = await agent.post('/api/comptabilite/lettrages').send({ ecritureIds: ids })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('La somme des écritures sélectionnées doit être nulle (écart 150,00).')
  })

  it('ne lettre qu’une fois les mêmes lignes envoyées simultanément', async () => {
    expect((await upload(Buffer.from([
      'date;journal;piece;compte;libelle;debit;credit',
      '2026-10-02;VT;F2026-020;411004;Facture Leroy;90,00;',
      '2026-10-02;VT;F2026-020;706000;Facture Leroy;;90,00',
      '2026-10-09;BQ;E2026-020;512000;Encaissement Leroy;90,00;',
      '2026-10-09;BQ;E2026-020;411004;Encaissement Leroy;;90,00',
    ].join('\n')))).status).toBe(201)
    const selection = (await ecrituresDuCompte('411004')).map((ligne) => ligne.id)

    const statuses = (await Promise.all([
      agent.post('/api/comptabilite/lettrages').send({ ecritureIds: selection }),
      agent.post('/api/comptabilite/lettrages').send({ ecritureIds: selection }),
    ])).map((response) => response.status).sort()

    expect(statuses).toEqual([201, 409])
  })

  it('délettre un code puis permet de relettrer les mêmes lignes', async () => {
    const removed = await agent.delete('/api/comptabilite/lettrages/411001/A')

    expect(removed.status).toBe(204)
    expect((await ecrituresDuCompte('411001')).every((ligne) => ligne.lettrage === null)).toBe(true)
    expect((await agent.delete('/api/comptabilite/lettrages/411001/A')).status).toBe(404)
  })
})
