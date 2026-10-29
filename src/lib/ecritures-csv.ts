import { createHash } from 'node:crypto'
import { httpError } from './http-error.ts'
import { parseCsvAmount } from './money.ts'

export interface EcritureCsv {
  ligne: number
  date: string
  journal: string
  piece: string
  compte: string
  libelle: string
  debit: bigint
  credit: bigint
  hash: string
}

export interface LigneErreur {
  ligne: number
  // « JOURNAL PIECE », null si la ligne ne permet pas d'identifier sa pièce.
  piece: string | null
  type: 'erreur' | 'doublon'
  message: string
}

export interface EcrituresCsvResult {
  lignes: EcritureCsv[]
  erreurs: LigneErreur[]
  lignesLues: number
}

export const csvColumns = ['date', 'journal', 'piece', 'compte', 'libelle', 'debit', 'credit'] as const
export const csvMaxLines = 10000

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const frenchDatePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/
const journalPattern = /^[A-Z0-9]{1,10}$/
const comptePattern = /^[0-9][0-9A-Z]{2,19}$/
const controlCharacters = /[\u0000-\u001f\u007f]/

export function pieceKey(journal: string, piece: string): string {
  return `${journal} ${piece}`
}

// Excel enregistre souvent les CSV en Windows-1252 : on retombe dessus si l'UTF-8 est invalide.
function decode(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

// Champs séparés par « ; », guillemets doubles optionnels (« "" » pour un guillemet littéral).
function splitLine(line: string): string[] | null {
  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quoted) {
      if (char !== '"') {
        field += char
      } else if (line[index + 1] === '"') {
        field += '"'
        index++
      } else {
        quoted = false
      }
    } else if (char === '"' && field.trim() === '') {
      field = ''
      quoted = true
    } else if (char === ';') {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }

  if (quoted) {
    return null
  }

  fields.push(field)
  // Certains tableurs ajoutent un « ; » final à chaque ligne.
  while (fields.length > csvColumns.length && fields.at(-1)?.trim() === '') {
    fields.pop()
  }

  return fields
}

function parseDate(value: string): string | null {
  const iso = isoDatePattern.exec(value)
  const french = frenchDatePattern.exec(value)
  const [year, month, day] = iso
    ? [iso[1], iso[2], iso[3]]
    : french
      ? [french[3], french[2], french[1]]
      : []

  if (!year) {
    return null
  }

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const normalized = `${year}-${month}-${day}`
  return date.toISOString().slice(0, 10) === normalized ? normalized : null
}

function lineHash(ecriture: Omit<EcritureCsv, 'ligne' | 'hash'>): string {
  return createHash('sha256')
    .update([
      ecriture.date,
      ecriture.journal,
      ecriture.piece,
      ecriture.compte,
      ecriture.libelle,
      ecriture.debit,
      ecriture.credit,
    ].join('|'))
    .digest('hex')
}

function parseLine(fields: string[], ligne: number): EcritureCsv | LigneErreur {
  const [rawDate, rawJournal, rawPiece, rawCompte, rawLibelle, rawDebit, rawCredit] = fields.map((field) => field.trim())
  const journal = rawJournal.toUpperCase()
  const piece = rawPiece
  const compte = rawCompte.toUpperCase()
  const libelle = rawLibelle.replace(/\s+/g, ' ')
  const date = parseDate(rawDate)
  const debit = parseCsvAmount(rawDebit)
  const credit = parseCsvAmount(rawCredit)
  const problems: string[] = []

  if (!date) {
    problems.push(`date invalide « ${rawDate} » (attendu AAAA-MM-JJ ou JJ/MM/AAAA)`)
  }
  if (!journalPattern.test(journal)) {
    problems.push(`journal invalide « ${rawJournal} » (1 à 10 lettres ou chiffres)`)
  }
  if (!piece || piece.length > 30 || controlCharacters.test(piece)) {
    problems.push('n° de pièce requis (30 caractères maximum)')
  }
  if (!comptePattern.test(compte)) {
    problems.push(`compte invalide « ${rawCompte} » (3 à 20 caractères commençant par un chiffre)`)
  }
  if (!libelle || libelle.length > 255) {
    problems.push('libellé requis (255 caractères maximum)')
  }
  if (debit === null) {
    problems.push(`débit invalide « ${rawDebit} »`)
  }
  if (credit === null) {
    problems.push(`crédit invalide « ${rawCredit} »`)
  }
  if (debit !== null && credit !== null) {
    if (debit === 0n && credit === 0n) {
      problems.push('la ligne doit porter un débit ou un crédit')
    } else if (debit > 0n && credit > 0n) {
      problems.push('la ligne ne peut pas porter à la fois un débit et un crédit')
    }
  }

  const pieceIdentifiable = journalPattern.test(journal) && piece !== '' && piece.length <= 30
  if (problems.length > 0) {
    return {
      ligne,
      piece: pieceIdentifiable ? pieceKey(journal, piece) : null,
      type: 'erreur',
      message: `Ligne invalide : ${problems.join(' ; ')}.`,
    }
  }

  const ecriture = { date: date!, journal, piece, compte, libelle, debit: debit!, credit: credit! }
  return { ligne, ...ecriture, hash: lineHash(ecriture) }
}

export function parseEcrituresCsv(buffer: Buffer): EcrituresCsvResult {
  const rows = decode(buffer).split(/\r\n|\n|\r/)
  const header = splitLine(rows[0] ?? '')?.map((column) => column.trim().toLowerCase())

  if (!header || header.join(';') !== csvColumns.join(';')) {
    throw httpError(400, `L’en-tête du fichier doit être exactement : ${csvColumns.join(';')}.`)
  }

  const lignes: EcritureCsv[] = []
  const erreurs: LigneErreur[] = []
  let lignesLues = 0

  for (let index = 1; index < rows.length; index++) {
    if (rows[index].trim() === '') {
      continue
    }

    lignesLues++
    if (lignesLues > csvMaxLines) {
      throw httpError(400, `Le fichier dépasse la limite de ${csvMaxLines} lignes.`)
    }

    const ligne = index + 1
    const fields = splitLine(rows[index])
    if (!fields || fields.length !== csvColumns.length) {
      // On tente quand même d'identifier la pièce pour la rejeter en entier.
      const journal = fields?.[1]?.trim().toUpperCase() ?? ''
      const piece = fields?.[2]?.trim() ?? ''
      erreurs.push({
        ligne,
        piece: journalPattern.test(journal) && piece && piece.length <= 30 ? pieceKey(journal, piece) : null,
        type: 'erreur',
        message: fields
          ? `Ligne invalide : ${fields.length} colonnes trouvées, ${csvColumns.length} attendues.`
          : 'Ligne invalide : guillemet non fermé.',
      })
      continue
    }

    const parsed = parseLine(fields, ligne)
    if ('hash' in parsed) {
      lignes.push(parsed)
    } else {
      erreurs.push(parsed)
    }
  }

  if (lignesLues === 0) {
    throw httpError(400, 'Le fichier ne contient aucune écriture.')
  }

  return { lignes, erreurs, lignesLues }
}
