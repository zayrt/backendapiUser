import { centsToDecimal, decimalToCents } from '../lib/money.ts'
import { prisma } from '../lib/prisma.ts'

export interface BalanceCompte {
  compte: string
  debit: string
  credit: string
  // Positif : solde débiteur ; négatif : solde créditeur.
  solde: string
}

export interface Balance {
  comptes: BalanceCompte[]
  totaux: { debit: string, credit: string, solde: string }
  equilibree: boolean
}

export async function getBalance(): Promise<Balance> {
  // Les sommes restent en NUMERIC côté SQL et arrivent en texte : aucun float.
  const rows = await prisma.$queryRaw<Array<{ compte: string, debit: string, credit: string }>>`
    SELECT compte, SUM(debit)::text AS debit, SUM(credit)::text AS credit
    FROM ecritures
    GROUP BY compte
    ORDER BY compte
  `

  let totalDebit = 0n
  let totalCredit = 0n
  const comptes = rows.map((row) => {
    const debit = decimalToCents(row.debit)
    const credit = decimalToCents(row.credit)
    totalDebit += debit
    totalCredit += credit

    return {
      compte: row.compte,
      debit: centsToDecimal(debit),
      credit: centsToDecimal(credit),
      solde: centsToDecimal(debit - credit),
    }
  })

  return {
    comptes,
    totaux: {
      debit: centsToDecimal(totalDebit),
      credit: centsToDecimal(totalCredit),
      solde: centsToDecimal(totalDebit - totalCredit),
    },
    equilibree: totalDebit === totalCredit,
  }
}
