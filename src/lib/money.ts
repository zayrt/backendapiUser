// Montants manipulés en centimes (bigint) : aucun calcul ne passe par un float.

const csvAmountPattern = /^(\d{1,10})(?:[.,](\d{1,2}))?$/
const decimalPattern = /^(-?)(\d+)(?:\.(\d{1,2}))?$/

// Accepte « 1200 », « 1200,5 », « 1 200,50 » ou « 1200.50 » ; vide vaut 0.
// Renvoie null pour un montant invalide, négatif ou hors NUMERIC(12,2).
export function parseCsvAmount(value: string): bigint | null {
  const compact = value.replace(/[\s  ]/g, '')
  if (compact === '') {
    return 0n
  }

  const match = csvAmountPattern.exec(compact)
  if (!match) {
    return null
  }

  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}

// Convertit une valeur NUMERIC renvoyée par PostgreSQL (« -1200.50 ») en centimes.
export function decimalToCents(value: string): bigint {
  const match = decimalPattern.exec(value.trim())
  if (!match) {
    throw new Error(`Montant décimal invalide : ${value}`)
  }

  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))
  return match[1] === '-' ? -cents : cents
}

export function centsToDecimal(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const absolute = cents < 0n ? -cents : cents
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

// Format lisible pour les messages d'erreur : « 1 200,50 ».
export function formatCents(cents: bigint): string {
  const [units, decimals] = centsToDecimal(cents).split('.')
  return `${units.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decimals}`
}
