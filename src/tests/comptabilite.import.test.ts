import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const transaction = {
    importComptable: { create: vi.fn() },
    ecriture: { createMany: vi.fn() },
  }

  return {
    transaction,
    prisma: {
      importComptable: { findUnique: vi.fn() },
      ecriture: { findMany: vi.fn() },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    },
  }
})

vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))

import request from 'supertest'
import app from '../app.ts'
import { parseEcrituresCsv } from '../lib/ecritures-csv.ts'
import { centsToDecimal, decimalToCents, parseCsvAmount } from '../lib/money.ts'
import { importEcritures } from '../services/import-ecritures.service.ts'
import { authenticatedAgent } from './helpers/auth.ts'

const header = 'date;journal;piece;compte;libelle;debit;credit'
const exemple = readFileSync(new URL('../../exemples/ecritures-exemple.csv', import.meta.url))

function csv(...lines: string[]): Buffer {
  return Buffer.from([header, ...lines].join('\n'))
}

function file(buffer: Buffer, originalname = 'ecritures.csv') {
  return { buffer, originalname }
}

function insertedRows() {
  return mocks.transaction.ecriture.createMany.mock.calls[0]?.[0].data ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.importComptable.findUnique.mockResolvedValue(null)
  mocks.prisma.ecriture.findMany.mockResolvedValue([])
  mocks.prisma.$queryRaw.mockResolvedValue([])
  mocks.prisma.$transaction.mockImplementation(
    (operations: (transaction: typeof mocks.transaction) => Promise<unknown>) => operations(mocks.transaction),
  )
  mocks.transaction.importComptable.create.mockResolvedValue({ id: 7 })
  mocks.transaction.ecriture.createMany.mockResolvedValue({ count: 0 })
})

describe('montants', () => {
  it.each([
    ['', 0n],
    ['0', 0n],
    ['1200', 120000n],
    ['1200,5', 120050n],
    ['1 200,50', 120050n],
    ['1 200,50', 120050n],
    ['1200.05', 120005n],
    ['9999999999,99', 999999999999n],
  ])('lit « %s » en %s centimes', (value, cents) => {
    expect(parseCsvAmount(value)).toBe(cents)
  })

  it.each(['-10', '1.234,56', '12,345', 'abc', '10000000000', '1e3'])('refuse « %s »', (value) => {
    expect(parseCsvAmount(value)).toBeNull()
  })

  it('additionne sans erreur d’arrondi flottant (0,10 + 0,20 = 0,30)', () => {
    const total = parseCsvAmount('0,10')! + parseCsvAmount('0,20')!
    expect(centsToDecimal(total)).toBe('0.30')
    expect(decimalToCents('-1200.5')).toBe(-120050n)
  })
})

describe('parseEcrituresCsv', () => {
  it('lit les colonnes, normalise les formats français et calcule un hash par ligne', () => {
    const { lignes, erreurs, lignesLues } = parseEcrituresCsv(csv(
      '02/09/2026;vt;F1;411001;"Facture ""Dupont""; SARL";1 200,00;',
      '2026-09-02;VT;F1;706000;  Facture   Dupont ;;1200',
    ))

    expect(erreurs).toEqual([])
    expect(lignesLues).toBe(2)
    expect(lignes[0]).toMatchObject({
      ligne: 2,
      date: '2026-09-02',
      journal: 'VT',
      piece: 'F1',
      compte: '411001',
      libelle: 'Facture "Dupont"; SARL',
      debit: 120000n,
      credit: 0n,
    })
    expect(lignes[1]).toMatchObject({ ligne: 3, libelle: 'Facture Dupont', debit: 0n, credit: 120000n })
    expect(lignes[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(lignes[0].hash).not.toBe(lignes[1].hash)
  })

  it('donne le même hash à deux lignes identiques au format près', () => {
    const { lignes } = parseEcrituresCsv(csv(
      '2026-09-02;VT;F1;411001;Facture;1200;',
      '02/09/2026;vt;F1;411001;Facture ;1 200,00;',
    ))

    expect(lignes[0].hash).toBe(lignes[1].hash)
  })

  it('accepte un BOM, des fins de ligne Windows, un « ; » final et un fichier Windows-1252', () => {
    const utf8 = Buffer.from(`﻿${header};\r\n2026-09-02;VT;F1;411001;Réglé;10;;\r\n`)
    const windows1252 = Buffer.concat([
      Buffer.from(`${header}\r\n2026-09-02;VT;F1;411001;R`),
      Buffer.from([0xe9]), // « é » en Windows-1252
      Buffer.from('gl'),
      Buffer.from([0xe9]),
      Buffer.from(';10;\r\n'),
    ])

    for (const content of [utf8, windows1252]) {
      const { lignes, erreurs } = parseEcrituresCsv(content)
      expect(erreurs).toEqual([])
      expect(lignes[0]).toMatchObject({ libelle: 'Réglé', debit: 1000n })
    }
  })

  it('signale chaque ligne invalide avec son numéro de ligne et sa pièce', () => {
    const { lignes, erreurs } = parseEcrituresCsv(csv(
      '2026-02-30;VT;F1;411001;Facture;10;',
      '2026-09-02;VT;F1;411001;Facture;10;10',
      '2026-09-02;VT;F1;411001;Facture;;',
      '2026-09-02;VT;F1;ABC;;-5;',
      '2026-09-02;VT;F1;411001',
      '',
      '2026-09-02;VT;F2;411001;"Facture;10;',
    ))

    expect(lignes).toEqual([])
    expect(erreurs.map(({ ligne, piece }) => [ligne, piece])).toEqual([
      [2, 'VT F1'], [3, 'VT F1'], [4, 'VT F1'], [5, 'VT F1'], [6, 'VT F1'], [8, null],
    ])
    expect(erreurs[0].message).toContain('date invalide « 2026-02-30 »')
    expect(erreurs[1].message).toContain('à la fois un débit et un crédit')
    expect(erreurs[2].message).toContain('doit porter un débit ou un crédit')
    expect(erreurs[3].message).toMatch(/compte invalide.*libellé requis.*débit invalide « -5 »/)
    expect(erreurs[4].message).toBe('Ligne invalide : 4 colonnes trouvées, 7 attendues.')
    expect(erreurs[5].message).toBe('Ligne invalide : guillemet non fermé.')
  })

  it.each([
    ['un en-tête différent', 'date,journal,piece,compte,libelle,debit,credit\n2026-09-02,VT,F1,411,X,1,'],
    ['un fichier sans écriture', `${header}\n\n`],
  ])('refuse %s avec HTTP 400', (_label, content) => {
    expect(() => parseEcrituresCsv(Buffer.from(content))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('importEcritures', () => {
  it('importe le fichier d’exemple : doublon ignoré, pièce déséquilibrée rejetée ligne par ligne', async () => {
    const report = await importEcritures(file(exemple, 'ecritures-exemple.csv'), 1)

    expect(report).toMatchObject({
      importId: 7,
      fichier: 'ecritures-exemple.csv',
      lignesLues: 20,
      lignesImportees: 15,
      lignesRejetees: 3,
      doublons: 2,
      piecesImportees: 6,
      piecesRejetees: 1,
    })
    expect(report.erreurs).toEqual([
      ...[15, 16, 17].map((ligne) => ({
        ligne,
        piece: 'VT F2026-004',
        type: 'erreur',
        message: 'Pièce déséquilibrée : débit 2 400,00 ≠ crédit 2 380,00 (écart 20,00).',
      })),
      { ligne: 20, piece: 'BQ E2026-003', type: 'doublon', message: 'Doublon de la ligne 18, ignoré.' },
      { ligne: 21, piece: 'BQ E2026-003', type: 'doublon', message: 'Doublon de la ligne 19, ignoré.' },
    ])
    expect(mocks.transaction.importComptable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nomFichier: 'ecritures-exemple.csv', lignesImportees: 15, accountId: 1 }),
      select: { id: true },
    })
    expect(insertedRows()).toHaveLength(15)
    expect(insertedRows()[0]).toMatchObject({
      date: new Date('2026-09-02T00:00:00.000Z'),
      compte: '411001',
      debit: '1200.00',
      credit: '0.00',
      importId: 7,
    })
    expect(insertedRows().some((row: { piece: string }) => row.piece === 'F2026-004')).toBe(false)
  })

  it('refuse avec HTTP 409 un fichier dont l’empreinte a déjà été importée', async () => {
    mocks.prisma.importComptable.findUnique.mockResolvedValue({ createdAt: new Date('2026-10-01T10:00:00Z') })

    await expect(importEcritures(file(exemple), 1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Ce fichier a déjà été importé le 1 octobre 2026.',
    })
    expect(mocks.prisma.importComptable.findUnique).toHaveBeenCalledWith({
      where: { hashFichier: expect.stringMatching(/^[0-9a-f]{64}$/) },
      select: { createdAt: true },
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('ignore les lignes déjà présentes en base et n’enregistre rien si tout est doublon', async () => {
    const content = csv('2026-09-02;BQ;E1;512000;Encaissement;50;', '2026-09-02;BQ;E1;411001;Encaissement;;50')
    const { lignes } = parseEcrituresCsv(content)
    mocks.prisma.ecriture.findMany.mockResolvedValue(lignes.map((ligne) => ({ ligneHash: ligne.hash })))

    const report = await importEcritures(file(content), 1)

    expect(report).toMatchObject({ importId: null, lignesImportees: 0, doublons: 2, lignesRejetees: 0 })
    expect(report.erreurs.map((erreur) => erreur.message)).toEqual([
      'Écriture déjà importée, ignorée.',
      'Écriture déjà importée, ignorée.',
    ])
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejette toute la pièce si une de ses lignes est invalide, sans bloquer les autres pièces', async () => {
    const report = await importEcritures(file(csv(
      '2026-09-02;VT;F1;411001;Facture;100;',
      '2026-09-02;VT;F1;706000;Facture;;abc',
      '2026-09-03;VT;F2;411002;Facture;80;',
      '2026-09-03;VT;F2;706000;Facture;;80',
    )), 1)

    expect(report).toMatchObject({ lignesImportees: 2, lignesRejetees: 2, piecesImportees: 1, piecesRejetees: 1 })
    expect(report.erreurs).toEqual([
      { ligne: 2, piece: 'VT F1', type: 'erreur', message: 'Pièce rejetée : ligne 3 invalide.' },
      expect.objectContaining({ ligne: 3, piece: 'VT F1', message: expect.stringContaining('crédit invalide « abc »') }),
    ])
    expect(insertedRows().map((row: { piece: string }) => row.piece)).toEqual(['F2', 'F2'])
  })

  it('rejette une pièce dont le numéro existe déjà en base avec un autre contenu', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ journal: 'VT', piece: 'F1' }])

    const report = await importEcritures(file(csv(
      '2026-09-02;VT;F1;411001;Facture corrigée;100;',
      '2026-09-02;VT;F1;706000;Facture corrigée;;100',
    )), 1)

    expect(report.importId).toBeNull()
    expect(report.erreurs[0].message).toBe('Pièce rejetée : ce n° de pièce existe déjà en base avec un contenu différent.')
  })

  it('compare débit et crédit au centime près', async () => {
    const report = await importEcritures(file(csv(
      '2026-09-02;OD;X1;512000;Virement;0,10;',
      '2026-09-02;OD;X1;512000;Virement bis;0,20;',
      '2026-09-02;OD;X1;411001;Virement;;0,30',
      '2026-09-02;OD;X2;512000;Virement;0,10;',
      '2026-09-02;OD;X2;411001;Virement;;0,11',
    )), 1)

    expect(report).toMatchObject({ piecesImportees: 1, piecesRejetees: 1 })
    expect(report.erreurs[0].message).toBe('Pièce déséquilibrée : débit 0,10 ≠ crédit 0,11 (écart 0,01).')
  })

  it('traduit une collision d’import simultané en HTTP 409', async () => {
    mocks.transaction.ecriture.createMany.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(importEcritures(file(exemple), 1)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuse un fichier absent ou sans extension .csv', async () => {
    await expect(importEcritures(undefined, 1)).rejects.toMatchObject({ statusCode: 400 })
    await expect(importEcritures(file(exemple, 'ecritures.xlsx'), 1)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('POST /api/comptabilite/imports', () => {
  const api = authenticatedAgent(app, 3)

  it('exige une session', async () => {
    const response = await request(app)
      .post('/api/comptabilite/imports')
      .attach('fichier', exemple, { filename: 'ecritures.csv', contentType: 'text/csv' })

    expect(response.status).toBe(401)
    expect(mocks.prisma.importComptable.findUnique).not.toHaveBeenCalled()
  })

  it('renvoie 201 et le rapport, en attribuant l’import au compte connecté', async () => {
    const response = await api
      .post('/api/comptabilite/imports')
      .attach('fichier', exemple, { filename: 'ecritures-exemple.csv', contentType: 'text/csv' })

    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({ importId: 7, lignesImportees: 15, doublons: 2, piecesRejetees: 1 })
    expect(mocks.transaction.importComptable.create.mock.calls[0][0].data.accountId).toBe(3)
  })

  it('renvoie 200 sans créer d’import quand aucune ligne n’est importable', async () => {
    const response = await api
      .post('/api/comptabilite/imports')
      .attach('fichier', csv('2026-09-02;VT;F1;411001;Facture;100;'), { filename: 'f.csv', contentType: 'text/csv' })

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ importId: null, piecesRejetees: 1 })
  })

  it('répond 400 sans fichier ou pour un en-tête invalide, 413 au-delà de 2 Mo', async () => {
    const noFile = await api.post('/api/comptabilite/imports')
    const badHeader = await api
      .post('/api/comptabilite/imports')
      .attach('fichier', Buffer.from('a;b\n1;2'), { filename: 'f.csv', contentType: 'text/csv' })
    const tooLarge = await api
      .post('/api/comptabilite/imports')
      .attach('fichier', Buffer.alloc(2 * 1024 * 1024 + 1, 'a'), { filename: 'f.csv', contentType: 'text/csv' })

    expect(noFile.status).toBe(400)
    expect(badHeader.status).toBe(400)
    expect(badHeader.body.error.message).toContain('date;journal;piece;compte;libelle;debit;credit')
    expect(tooLarge.status).toBe(413)
  })
})
