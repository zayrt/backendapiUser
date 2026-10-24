import { deleteAvatar, isCloudinaryConfigured, uploadAvatar } from '../lib/cloudinary.ts'
import { emailPattern, hasPrismaErrorCode, httpError } from '../lib/http-error.ts'
import { prisma } from '../lib/prisma.ts'

export interface User {
  id: number
  name: string
  email: string
  avatarUrl: string | null
}

interface UserInput {
  name: string
  email: string
}

export interface AvatarFile {
  buffer: Buffer
  mimetype: string
}

const userSelect = { id: true, name: true, email: true, avatarUrl: true } as const

const avatarSignatures: Record<string, (image: Buffer) => boolean> = {
  'image/jpeg': (image) => image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/png': (image) => image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (image) => image.subarray(0, 4).toString('latin1') === 'RIFF'
    && image.subarray(8, 12).toString('latin1') === 'WEBP',
}
const userPageSize = 10

export interface UsersPage {
  data: User[]
  pagination: {
    currentPage: number
    totalPages: number
    totalItems: number
  }
}

function parseUserId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw httpError(400, 'L’identifiant doit être un entier positif.')
  }

  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) {
    throw httpError(400, 'L’identifiant doit être un entier positif.')
  }

  return id
}

function validateUser(payload: unknown): UserInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw httpError(400, 'Le corps de la requête doit être un objet JSON.')
  }

  const body = payload as Record<string, unknown>
  const allowedFields = new Set(['name', 'email'])
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw httpError(400, 'Seuls les champs name et email sont acceptés.')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!name || name.length > 100) {
    throw httpError(400, 'name est requis et doit contenir au maximum 100 caractères.')
  }

  if (email.length > 254 || !emailPattern.test(email)) {
    throw httpError(400, 'email doit être une adresse e-mail valide.')
  }

  return { name, email }
}

function validateAvatar(file: AvatarFile | undefined): Buffer {
  if (!file) {
    throw httpError(400, 'Ajoutez une image dans le champ avatar.')
  }

  const matchesSignature = avatarSignatures[file.mimetype]
  if (!matchesSignature?.(file.buffer)) {
    throw httpError(400, 'La photo doit être une image JPG, PNG ou WebP.')
  }

  return file.buffer
}

function throwWriteError(error: unknown): never {
  if (hasPrismaErrorCode(error, 'P2002')) {
    throw httpError(409, 'Cette adresse e-mail est déjà utilisée.')
  }

  if (hasPrismaErrorCode(error, 'P2025')) {
    throw httpError(404, 'Utilisateur introuvable.')
  }

  throw error
}

export async function getUsers(page: number): Promise<UsersPage> {
  const skip = (page - 1) * userPageSize
  const [data, totalItems] = await prisma.$transaction([
    prisma.user.findMany({
      skip,
      take: userPageSize,
      select: userSelect,
      orderBy: { id: 'asc' },
    }),
    prisma.user.count(),
  ])

  return {
    data,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalItems / userPageSize),
      totalItems,
    },
  }
}

export async function getUserById(value: string): Promise<User> {
  const user = await prisma.user.findUnique({
    where: { id: parseUserId(value) },
    select: userSelect,
  })

  if (!user) {
    throw httpError(404, 'Utilisateur introuvable.')
  }

  return user
}

export async function createUser(payload: unknown): Promise<User> {
  const userData = validateUser(payload)

  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: userData, select: userSelect })
      await transaction.userAuditLog.create({ data: { userId: user.id, action: 'CREATE' } })
      return user
    })
  } catch (error: unknown) {
    return throwWriteError(error)
  }
}

export async function updateUser(value: string, payload: unknown): Promise<User> {
  const id = parseUserId(value)
  const userData = validateUser(payload)

  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({ where: { id }, data: userData, select: userSelect })
      await transaction.userAuditLog.create({ data: { userId: id, action: 'UPDATE' } })
      return user
    })
  } catch (error: unknown) {
    return throwWriteError(error)
  }
}

export async function updateUserAvatar(value: string, file: AvatarFile | undefined): Promise<User> {
  const id = parseUserId(value)
  const image = validateAvatar(file)

  if (!isCloudinaryConfigured()) {
    throw httpError(503, 'L’upload de photo n’est pas configuré sur le serveur.')
  }

  await getUserById(value)
  const avatarUrl = await uploadAvatar(image, id).catch((error: unknown) => {
    console.error(error)
    throw httpError(502, 'L’envoi de la photo a échoué. Réessayez plus tard.')
  })

  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({ where: { id }, data: { avatarUrl }, select: userSelect })
      await transaction.userAuditLog.create({ data: { userId: id, action: 'UPDATE' } })
      return user
    })
  } catch (error: unknown) {
    if (hasPrismaErrorCode(error, 'P2025')) {
      await deleteAvatar(id).catch((cleanupError: unknown) => console.error(cleanupError))
    }

    return throwWriteError(error)
  }
}

export async function deleteUser(value: string): Promise<void> {
  const id = parseUserId(value)

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const deletedUser = await transaction.user.delete({ where: { id }, select: userSelect })
      await transaction.userAuditLog.create({ data: { userId: id, action: 'DELETE' } })
      return deletedUser
    })

    if (user.avatarUrl && isCloudinaryConfigured()) {
      void deleteAvatar(id).catch((cleanupError: unknown) => console.error(cleanupError))
    }
  } catch (error: unknown) {
    return throwWriteError(error)
  }
}