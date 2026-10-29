import { httpError } from '../lib/http-error.ts'
import { decimalToCents, formatCents } from '../lib/money.ts'
import { prisma } from '../lib/prisma.ts'

export interface EcritureCompte {
  id: number
  date: string
  journal: string
  piece: string
  compte: string
  libelle: string
  debit: string
  credit: string
  lettrage: string | null
}

export interface Lettrage {
  compte: string
  code: string
  ecritureIds: number[]
}

const comptePattern = /^[0-9][0-9A-Z]{2,19}$/
const codePattern = /^[A-Z]{1,10}$/
const maxLignesLettrage = 200

export function isCompteLettrable(compte: string): boolean {
  return compte.startsWith('411') || compte.startsWith('512')
}

function parseCompte(value: unknown): string {
  const compte = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!comptePattern.test(compte)) {
    throw httpError(400, 'compte doit être un numéro de compte valide.')
  }

  return compte
}

function parseLettrableCompte(value: unknown): string {
  const compte = parseCompte(value)
  if (!isCompteLettrable(compte)) {
    throw httpError(400, 'Seuls les comptes 411 (clients) et 512 (banque) peuvent être lettrés.')
  }

  return compte
}

function parseEcritureIds(payload: unknown): number[] {
  const ids = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).ecritureIds
    : undefined

  if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && (id as number) > 0)) {
    throw httpError(400, 'ecritureIds doit être une liste d’identifiants d’écritures.')
  }

  const unique = [...new Set(ids as number[])].sort((left, right) => left - right)
  if (unique.length < 2 || unique.length > maxLignesLettrage) {
    throw httpError(400, `Sélectionnez entre 2 et ${maxLignesLettrage} écritures distinctes.`)
  }

  return unique
}

// Suite A, B, …, Z, AA, AB, … : le code suivant le plus grand code existant.
export function nextLettrageCode(existing: string[]): string {
  const highest = existing
    .filter((code) => codePattern.test(code))
    .sort((left, right) => left.length - right.length || (left < right ? -1 : 1))
    .at(-1)

  if (!highest) {
    return 'A'
  }

  const letters = [...highest]
  let index = letters.length - 1
  while (index >= 0 && letters[index] === 'Z') {
    letters[index] = 'A'
    index--
  }

  if (index < 0) {
    return `A${letters.join('')}`
  }

  letters[index] = String.fromCharCode(letters[index].charCodeAt(0) + 1)
  return letters.join('')
}

// Sans compte : tout le journal, pour l'écran Écritures et le tableau de bord.
export async function getEcrituresCompte(value: unknown): Promise<EcritureCompte[]> {
  const where = value === undefined ? {} : { compte: parseCompte(value) }
  const ecritures = await prisma.ecriture.findMany({
    where,
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      date: true,
      journal: true,
      piece: true,
      compte: true,
      libelle: true,
      debit: true,
      credit: true,
      lettrage: true,
    },
  })

  return ecritures.map((ecriture) => ({
    ...ecriture,
    date: ecriture.date.toISOString().slice(0, 10),
    debit: ecriture.debit.toFixed(2),
    credit: ecriture.credit.toFixed(2),
  }))
}

export async function lettrer(payload: unknown): Promise<Lettrage> {
  const ids = parseEcritureIds(payload)

  return prisma.$transaction(async (transaction) => {
    // FOR UPDATE : deux lettrages simultanés ne peuvent pas se partager une ligne.
    const lignes = await transaction.$queryRaw<Array<{
      id: number
      compte: string
      debit: string
      credit: string
      lettrage: string | null
    }>>`
      SELECT id, compte, debit::text AS debit, credit::text AS credit, code_lettrage AS lettrage
      FROM ecritures
      WHERE id = ANY(${ids}::int[])
      ORDER BY id
      FOR UPDATE
    `

    if (lignes.length !== ids.length) {
      throw httpError(404, 'Une ou plusieurs écritures sélectionnées sont introuvables.')
    }

    const comptes = new Set(lignes.map((ligne) => ligne.compte))
    if (comptes.size > 1) {
      throw httpError(400, 'Les écritures lettrées ensemble doivent appartenir au même compte.')
    }

    const compte = parseLettrableCompte(lignes[0].compte)
    if (lignes.some((ligne) => ligne.lettrage !== null)) {
      throw httpError(409, 'Une ou plusieurs écritures sélectionnées sont déjà lettrées.')
    }

    const solde = lignes.reduce((sum, ligne) => sum + decimalToCents(ligne.debit) - decimalToCents(ligne.credit), 0n)
    if (solde !== 0n) {
      throw httpError(400, `La somme des écritures sélectionnées doit être nulle (écart ${formatCents(solde)}).`)
    }

    // Verrou par compte : deux lettrages simultanés n'obtiennent pas le même code.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lettrage:${compte}`}))`
    const codes = await transaction.$queryRaw<Array<{ code: string }>>`
      SELECT DISTINCT code_lettrage AS code
      FROM ecritures
      WHERE compte = ${compte} AND code_lettrage IS NOT NULL
    `
    const code = nextLettrageCode(codes.map((row) => row.code))

    await transaction.ecriture.updateMany({ where: { id: { in: ids } }, data: { lettrage: code } })
    return { compte, code, ecritureIds: ids }
  })
}

export async function delettrer(compteValue: unknown, codeValue: unknown): Promise<void> {
  const compte = parseLettrableCompte(compteValue)
  const code = typeof codeValue === 'string' ? codeValue.trim().toUpperCase() : ''
  if (!codePattern.test(code)) {
    throw httpError(400, 'Le code de lettrage doit contenir de 1 à 10 lettres.')
  }

  const { count } = await prisma.ecriture.updateMany({
    where: { compte, lettrage: code },
    data: { lettrage: null },
  })

  if (count === 0) {
    throw httpError(404, `Aucun lettrage ${code} sur le compte ${compte}.`)
  }
}
