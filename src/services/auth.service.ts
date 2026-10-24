import bcrypt from 'bcrypt'
import { env } from '../config/env.ts'
import { emailPattern, hasPrismaErrorCode, httpError } from '../lib/http-error.ts'
import { prisma } from '../lib/prisma.ts'

export interface Account {
  id: number
  name: string
  email: string
}

interface Credentials {
  email: string
  password: string
}

const accountSelect = { id: true, name: true, email: true } as const
const bcryptRounds = env.nodeEnv === 'test' ? 4 : 12
const passwordMinLength = 8
const passwordMaxBytes = 72
let timingHash: Promise<string> | undefined

function readBody(payload: unknown, allowedFields: string[]): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw httpError(400, 'Le corps de la requête doit être un objet JSON.')
  }

  const body = payload as Record<string, unknown>
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw httpError(400, `Seuls les champs ${allowedFields.join(', ')} sont acceptés.`)
  }

  return body
}

function readEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (email.length > 254 || !emailPattern.test(email)) {
    throw httpError(400, 'email doit être une adresse e-mail valide.')
  }

  return email
}

function validateRegistration(payload: unknown): Credentials & { name: string } {
  const body = readBody(payload, ['name', 'email', 'password'])
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!name || name.length > 100) {
    throw httpError(400, 'name est requis et doit contenir au maximum 100 caractères.')
  }

  const email = readEmail(body.email)

  if (password.length < passwordMinLength || Buffer.byteLength(password) > passwordMaxBytes) {
    throw httpError(400, 'Le mot de passe doit contenir entre 8 et 72 caractères.')
  }

  return { name, email, password }
}

function validateCredentials(payload: unknown): Credentials {
  const body = readBody(payload, ['email', 'password'])
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    throw httpError(400, 'email et password sont requis.')
  }

  return { email, password }
}

// Compare toujours un hash, même pour un email inconnu, pour ne pas révéler
// par le temps de réponse quels comptes existent.
function getTimingHash(): Promise<string> {
  timingHash ??= bcrypt.hash('timing-equalizer', bcryptRounds)
  return timingHash
}

export async function registerAccount(payload: unknown): Promise<Account> {
  const { name, email, password } = validateRegistration(payload)
  const passwordHash = await bcrypt.hash(password, bcryptRounds)

  try {
    return await prisma.account.create({ data: { name, email, passwordHash }, select: accountSelect })
  } catch (error: unknown) {
    if (hasPrismaErrorCode(error, 'P2002')) {
      throw httpError(409, 'Un compte existe déjà avec cette adresse e-mail.')
    }

    throw error
  }
}

export async function authenticate(payload: unknown): Promise<Account> {
  const { email, password } = validateCredentials(payload)
  const account = await prisma.account.findUnique({
    where: { email },
    select: { ...accountSelect, passwordHash: true },
  })
  const passwordMatches = await bcrypt.compare(password, account?.passwordHash ?? await getTimingHash())

  if (!account || !passwordMatches) {
    throw httpError(401, 'Email ou mot de passe incorrect.')
  }

  return { id: account.id, name: account.name, email: account.email }
}

export async function getAccount(id: number): Promise<Account | null> {
  return prisma.account.findUnique({ where: { id }, select: accountSelect })
}
