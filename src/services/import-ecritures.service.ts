import { createHash } from 'node:crypto'
import {
  parseEcrituresCsv,
  pieceKey,
  type EcritureCsv,
  type LigneErreur,
} from '../lib/ecritures-csv.ts'
import { hasPrismaErrorCode, httpError } from '../lib/http-error.ts'
import { centsToDecimal, formatCents } from '../lib/money.ts'
import { prisma } from '../lib/prisma.ts'

export interface CsvFile {
  buffer: Buffer
  originalname: string
}

export interface ImportReport {
  importId: number | null
  fichier: string
  lignesLues: number
  lignesImportees: number
  lignesRejetees: number
  doublons: number
  piecesImportees: number
  piecesRejetees: number
  erreurs: LigneErreur[]
}

const parisDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' })

function validateFile(file: CsvFile | undefined): CsvFile {
  if (!file) {
    throw httpError(400, 'Ajoutez un fichier CSV dans le champ fichier.')
  }

  if (!/\.csv$/i.test(file.originalname)) {
    throw httpError(400, 'Le fichier doit être au format CSV (.csv).')
  }

  return file
}

function rejectPiece(lignes: EcritureCsv[], key: string, message: string): LigneErreur[] {
  return lignes.map((ecriture) => ({ ligne: ecriture.ligne, piece: key, type: 'erreur', message }))
}

async function findExistingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) {
    return new Set()
  }

  const existing = await prisma.ecriture.findMany({
    where: { ligneHash: { in: hashes } },
    select: { ligneHash: true },
  })
  return new Set(existing.map((ecriture) => ecriture.ligneHash))
}

async function findExistingPieces(pieces: EcritureCsv[][]): Promise<Set<string>> {
  if (pieces.length === 0) {
    return new Set()
  }

  const journals = pieces.map(([ecriture]) => ecriture.journal)
  const numeros = pieces.map(([ecriture]) => ecriture.piece)
  const existing = await prisma.$queryRaw<Array<{ journal: string, piece: string }>>`
    SELECT DISTINCT journal, piece
    FROM ecritures
    WHERE (journal, piece) IN (SELECT * FROM unnest(${journals}::text[], ${numeros}::text[]))
  `
  return new Set(existing.map((row) => pieceKey(row.journal, row.piece)))
}

export async function importEcritures(input: CsvFile | undefined, accountId: number): Promise<ImportReport> {
  const file = validateFile(input)
  const hashFichier = createHash('sha256').update(file.buffer).digest('hex')
  const previousImport = await prisma.importComptable.findUnique({
    where: { hashFichier },
    select: { createdAt: true },
  })

  if (previousImport) {
    throw httpError(409, `Ce fichier a déjà été importé le ${parisDate.format(previousImport.createdAt)}.`)
  }

  const { lignes, erreurs, lignesLues } = parseEcrituresCsv(file.buffer)

  // 1. Doublons : ligne identique plus haut dans le fichier, puis ligne déjà en base.
  const firstOccurrence = new Map<string, number>()
  const uniques: EcritureCsv[] = []
  for (const ecriture of lignes) {
    const previous = firstOccurrence.get(ecriture.hash)
    if (previous === undefined) {
      firstOccurrence.set(ecriture.hash, ecriture.ligne)
      uniques.push(ecriture)
    } else {
      erreurs.push({
        ligne: ecriture.ligne,
        piece: pieceKey(ecriture.journal, ecriture.piece),
        type: 'doublon',
        message: `Doublon de la ligne ${previous}, ignoré.`,
      })
    }
  }

  const existingHashes = await findExistingHashes(uniques.map((ecriture) => ecriture.hash))
  const candidates: EcritureCsv[] = []
  for (const ecriture of uniques) {
    if (existingHashes.has(ecriture.hash)) {
      erreurs.push({
        ligne: ecriture.ligne,
        piece: pieceKey(ecriture.journal, ecriture.piece),
        type: 'doublon',
        message: 'Écriture déjà importée, ignorée.',
      })
    } else {
      candidates.push(ecriture)
    }
  }

  // 2. Contrôle par pièce : une pièce est importée en entier ou pas du tout.
  const pieces = new Map<string, EcritureCsv[]>()
  for (const ecriture of candidates) {
    const key = pieceKey(ecriture.journal, ecriture.piece)
    pieces.set(key, [...(pieces.get(key) ?? []), ecriture])
  }

  const invalidLinesByPiece = new Map<string, number[]>()
  for (const erreur of erreurs) {
    if (erreur.type === 'erreur' && erreur.piece) {
      invalidLinesByPiece.set(erreur.piece, [...(invalidLinesByPiece.get(erreur.piece) ?? []), erreur.ligne])
    }
  }

  const existingPieces = await findExistingPieces([...pieces.values()])
  const accepted: EcritureCsv[] = []
  let piecesImportees = 0
  let piecesRejetees = new Set(invalidLinesByPiece.keys()).size

  for (const [key, ecritures] of pieces) {
    const invalidLines = invalidLinesByPiece.get(key)
    const debit = ecritures.reduce((sum, ecriture) => sum + ecriture.debit, 0n)
    const credit = ecritures.reduce((sum, ecriture) => sum + ecriture.credit, 0n)

    if (invalidLines) {
      const plural = invalidLines.length > 1 ? 's' : ''
      erreurs.push(...rejectPiece(ecritures, key,
        `Pièce rejetée : ligne${plural} ${invalidLines.join(', ')} invalide${plural}.`))
    } else if (existingPieces.has(key)) {
      piecesRejetees++
      erreurs.push(...rejectPiece(ecritures, key,
        'Pièce rejetée : ce n° de pièce existe déjà en base avec un contenu différent.'))
    } else if (debit !== credit) {
      piecesRejetees++
      const ecart = debit > credit ? debit - credit : credit - debit
      erreurs.push(...rejectPiece(ecritures, key,
        `Pièce déséquilibrée : débit ${formatCents(debit)} ≠ crédit ${formatCents(credit)} (écart ${formatCents(ecart)}).`))
    } else {
      piecesImportees++
      accepted.push(...ecritures)
    }
  }

  erreurs.sort((left, right) => left.ligne - right.ligne)
  const doublons = erreurs.filter((erreur) => erreur.type === 'doublon').length
  const report: ImportReport = {
    importId: null,
    fichier: file.originalname,
    lignesLues,
    lignesImportees: accepted.length,
    lignesRejetees: lignesLues - accepted.length - doublons,
    doublons,
    piecesImportees,
    piecesRejetees,
    erreurs,
  }

  if (accepted.length === 0) {
    return report
  }

  try {
    report.importId = await prisma.$transaction(async (transaction) => {
      const created = await transaction.importComptable.create({
        data: {
          nomFichier: file.originalname.slice(0, 255),
          hashFichier,
          lignesImportees: accepted.length,
          accountId,
        },
        select: { id: true },
      })

      await transaction.ecriture.createMany({
        data: accepted.map((ecriture) => ({
          date: new Date(`${ecriture.date}T00:00:00.000Z`),
          journal: ecriture.journal,
          piece: ecriture.piece,
          compte: ecriture.compte,
          libelle: ecriture.libelle,
          debit: centsToDecimal(ecriture.debit),
          credit: centsToDecimal(ecriture.credit),
          ligneHash: ecriture.hash,
          importId: created.id,
        })),
      })

      return created.id
    })
  } catch (error: unknown) {
    if (hasPrismaErrorCode(error, 'P2002')) {
      throw httpError(409, 'Un import simultané a déjà enregistré ce fichier ou certaines de ses écritures. Relancez l’import.')
    }

    throw error
  }

  return report
}
