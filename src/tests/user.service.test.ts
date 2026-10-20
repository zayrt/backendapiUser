import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const transaction = {
    user: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userAuditLog: { create: vi.fn() },
  }

  return {
    transaction,
    prisma: {
      ...transaction,
      $transaction: vi.fn(),
    },
  }
})

vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))

import {
  createUser,
  deleteUser,
  getUserById,
  getUsers,
  updateUser,
} from '../services/user.service.ts'

const user = { id: 42, name: 'Karim', email: 'karim@example.com' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.$transaction.mockImplementation((operations: unknown) => {
    if (Array.isArray(operations)) {
      return Promise.all(operations)
    }

    return (operations as (transaction: typeof mocks.transaction) => Promise<unknown>)(mocks.transaction)
  })
})

describe('user.service', () => {
  it('normalise le nom et l’email avant prisma.user.create', async () => {
    mocks.transaction.user.create.mockResolvedValue(user)

    await expect(createUser({ name: '  Karim  ', email: '  KARIM@example.com  ' })).resolves.toEqual(user)
    expect(mocks.transaction.user.create).toHaveBeenCalledWith({
      data: { name: 'Karim', email: 'karim@example.com' },
      select: { id: true, name: true, email: true },
    })
    expect(mocks.transaction.userAuditLog.create).toHaveBeenCalledWith({
      data: { userId: 42, action: 'CREATE' },
    })
  })

  it('ne crée aucun audit CREATE si la création échoue', async () => {
    mocks.transaction.user.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }))

    await expect(createUser({ name: 'Karim', email: 'karim@example.com' }))
      .rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.transaction.userAuditLog.create).not.toHaveBeenCalled()
  })

  it('rejette un nom ou un email invalide sans appeler Prisma', async () => {
    await expect(createUser({ name: '  ', email: 'bad' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.transaction.user.create).not.toHaveBeenCalled()
  })

  it('mappe une contrainte unique email P2002 en 409', async () => {
    mocks.transaction.user.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }))

    await expect(createUser({ name: 'Karim', email: 'karim@example.com' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Cette adresse e-mail est déjà utilisée.' })
  })

  it('enregistre UPDATE dans la transaction après une mise à jour réussie', async () => {
    mocks.transaction.user.update.mockResolvedValue(user)

    await expect(updateUser('42', { name: 'Karim', email: 'karim@example.com' })).resolves.toEqual(user)
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    expect(mocks.transaction.userAuditLog.create).toHaveBeenCalledWith({
      data: { userId: 42, action: 'UPDATE' },
    })
  })

  it('ne crée aucun audit UPDATE si la modification échoue', async () => {
    mocks.transaction.user.update.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2025' }))

    await expect(updateUser('42', { name: 'Karim', email: 'karim@example.com' }))
      .rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.transaction.userAuditLog.create).not.toHaveBeenCalled()
  })

  it('enregistre DELETE dans la transaction et conserve le userId', async () => {
    mocks.transaction.user.delete.mockResolvedValue(user)

    await expect(deleteUser('42')).resolves.toBeUndefined()
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    expect(mocks.transaction.userAuditLog.create).toHaveBeenCalledWith({
      data: { userId: 42, action: 'DELETE' },
    })
  })

  it('ne crée aucun audit DELETE si la suppression échoue', async () => {
    mocks.transaction.user.delete.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2025' }))

    await expect(deleteUser('42')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.transaction.userAuditLog.create).not.toHaveBeenCalled()
  })

  it('retourne une page triée avec total et calcule skip/take', async () => {
    mocks.transaction.user.findMany.mockResolvedValue([user])
    mocks.transaction.user.count.mockResolvedValue(57)
    mocks.transaction.user.findUnique.mockResolvedValue(user)

    await expect(getUsers(2)).resolves.toEqual({
      data: [user],
      pagination: { currentPage: 2, totalPages: 6, totalItems: 57 },
    })
    expect(mocks.transaction.user.findMany).toHaveBeenCalledWith({
      skip: 10,
      take: 10,
      select: { id: true, name: true, email: true },
      orderBy: { id: 'asc' },
    })
    expect(mocks.transaction.user.count).toHaveBeenCalledOnce()
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    await expect(getUserById('42')).resolves.toEqual(user)
    await expect(getUserById('not-an-id')).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.transaction.user.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { id: true, name: true, email: true },
    })
  })

  it('retourne zéro page pour une table vide et liste vide hors plage', async () => {
    mocks.transaction.user.findMany.mockResolvedValue([])
    mocks.transaction.user.count.mockResolvedValue(0)

    await expect(getUsers(1)).resolves.toEqual({
      data: [],
      pagination: { currentPage: 1, totalPages: 0, totalItems: 0 },
    })
    await expect(getUsers(9)).resolves.toEqual({
      data: [],
      pagination: { currentPage: 9, totalPages: 0, totalItems: 0 },
    })
  })

  it('calcule une page hors plage sans perdre le total global', async () => {
    mocks.transaction.user.findMany.mockResolvedValue([])
    mocks.transaction.user.count.mockResolvedValue(57)

    await expect(getUsers(9)).resolves.toEqual({
      data: [],
      pagination: { currentPage: 9, totalPages: 6, totalItems: 57 },
    })
    expect(mocks.transaction.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 80, take: 10 }))
  })

  it('utilise la première fenêtre avec skip zéro', async () => {
    mocks.transaction.user.findMany.mockResolvedValue([user])
    mocks.transaction.user.count.mockResolvedValue(57)

    await expect(getUsers(1)).resolves.toMatchObject({
      pagination: { currentPage: 1, totalPages: 6, totalItems: 57 },
    })
    expect(mocks.transaction.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }))
  })
})
