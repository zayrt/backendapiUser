import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const transaction = {
    user: { update: vi.fn(), delete: vi.fn() },
    userAuditLog: { create: vi.fn() },
  }

  return {
    transaction,
    prisma: {
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
    cloudinary: {
      isCloudinaryConfigured: vi.fn(),
      uploadAvatar: vi.fn(),
      deleteAvatar: vi.fn(),
    },
  }
})

vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))
vi.mock('../lib/cloudinary.ts', () => mocks.cloudinary)

import app from '../app.ts'
import { deleteUser, updateUserAvatar } from '../services/user.service.ts'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
const avatarUrl = 'https://res.cloudinary.com/demo/image/upload/v1/vueapp/avatars/user_42.png'
const user = { id: 42, name: 'Karim', email: 'karim@example.com', avatarUrl: null }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.$transaction.mockImplementation(
    (operations: (transaction: typeof mocks.transaction) => Promise<unknown>) => operations(mocks.transaction),
  )
  mocks.prisma.user.findUnique.mockResolvedValue(user)
  mocks.cloudinary.isCloudinaryConfigured.mockReturnValue(true)
  mocks.cloudinary.uploadAvatar.mockResolvedValue(avatarUrl)
  mocks.cloudinary.deleteAvatar.mockResolvedValue(undefined)
  mocks.transaction.user.update.mockResolvedValue({ ...user, avatarUrl })
  mocks.transaction.user.delete.mockResolvedValue(user)
})

describe('updateUserAvatar', () => {
  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
  ])('accepte %s, stocke uniquement l’URL et audite UPDATE', async (mimetype, buffer) => {
    await expect(updateUserAvatar('42', { mimetype, buffer })).resolves.toEqual({ ...user, avatarUrl })

    expect(mocks.cloudinary.uploadAvatar).toHaveBeenCalledWith(buffer, 42)
    expect(mocks.transaction.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { avatarUrl },
      select: { id: true, name: true, email: true, avatarUrl: true },
    })
    expect(mocks.transaction.userAuditLog.create).toHaveBeenCalledWith({ data: { userId: 42, action: 'UPDATE' } })
  })

  it('rejette un fichier absent, un type refusé ou un contenu qui ne correspond pas au type', async () => {
    await expect(updateUserAvatar('42', undefined)).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateUserAvatar('42', { mimetype: 'image/gif', buffer: Buffer.from('GIF89a') }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(updateUserAvatar('42', { mimetype: 'image/png', buffer: Buffer.from('<svg></svg>') }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.cloudinary.uploadAvatar).not.toHaveBeenCalled()
  })

  it('répond 404 sans uploader si l’utilisateur n’existe pas', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)

    await expect(updateUserAvatar('42', { mimetype: 'image/png', buffer: png })).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.cloudinary.uploadAvatar).not.toHaveBeenCalled()
  })

  it('répond 502 sans toucher à la base si Cloudinary échoue', async () => {
    mocks.cloudinary.uploadAvatar.mockRejectedValue(new Error('cloudinary down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(updateUserAvatar('42', { mimetype: 'image/png', buffer: png })).rejects.toMatchObject({ statusCode: 502 })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('supprime l’image uploadée si l’utilisateur disparaît avant la mise à jour', async () => {
    mocks.transaction.user.update.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2025' }))

    await expect(updateUserAvatar('42', { mimetype: 'image/png', buffer: png })).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.cloudinary.deleteAvatar).toHaveBeenCalledWith(42)
    expect(mocks.transaction.userAuditLog.create).not.toHaveBeenCalled()
  })
})

describe('deleteUser et avatar', () => {
  it('supprime l’image Cloudinary d’un utilisateur supprimé qui avait un avatar', async () => {
    mocks.transaction.user.delete.mockResolvedValue({ ...user, avatarUrl })

    await expect(deleteUser('42')).resolves.toBeUndefined()
    expect(mocks.cloudinary.deleteAvatar).toHaveBeenCalledWith(42)
  })

  it('n’appelle pas Cloudinary pour un utilisateur sans avatar', async () => {
    await expect(deleteUser('42')).resolves.toBeUndefined()
    expect(mocks.cloudinary.deleteAvatar).not.toHaveBeenCalled()
  })
})

describe('PUT /api/users/:id/avatar', () => {
  it('upload une image multipart et renvoie l’utilisateur avec avatarUrl', async () => {
    const response = await request(app)
      .put('/api/users/42/avatar')
      .attach('avatar', png, { filename: 'photo.png', contentType: 'image/png' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { ...user, avatarUrl } })
  })

  it('répond 413 au-delà de 2 Mo', async () => {
    const tooLarge = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)])
    const response = await request(app)
      .put('/api/users/42/avatar')
      .attach('avatar', tooLarge, { filename: 'photo.png', contentType: 'image/png' })

    expect(response.status).toBe(413)
    expect(response.body.error.message).toBe('La photo ne doit pas dépasser 2 Mo.')
    expect(mocks.cloudinary.uploadAvatar).not.toHaveBeenCalled()
  })

  it('accepte une image d’exactement 2 Mo', async () => {
    const exactly2Mb = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 - png.length)])
    const response = await request(app)
      .put('/api/users/42/avatar')
      .attach('avatar', exactly2Mb, { filename: 'photo.png', contentType: 'image/png' })

    expect(response.status).toBe(200)
  })

  it('répond 400 pour un mauvais nom de champ ou une requête sans fichier', async () => {
    const wrongField = await request(app)
      .put('/api/users/42/avatar')
      .attach('photo', png, { filename: 'photo.png', contentType: 'image/png' })
    const noFile = await request(app).put('/api/users/42/avatar')

    expect(wrongField.status).toBe(400)
    expect(noFile.status).toBe(400)
  })

  it('expose le message 503 quand Cloudinary n’est pas configuré', async () => {
    mocks.cloudinary.isCloudinaryConfigured.mockReturnValue(false)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(app)
      .put('/api/users/42/avatar')
      .attach('avatar', png, { filename: 'photo.png', contentType: 'image/png' })

    expect(response.status).toBe(503)
    expect(response.body.error.message).toBe('L’upload de photo n’est pas configuré sur le serveur.')
    consoleError.mockRestore()
  })

  it('refuse de définir avatarUrl via PUT /api/users/:id', async () => {
    const response = await request(app)
      .put('/api/users/42')
      .send({ name: 'Karim', email: 'karim@example.com', avatarUrl: 'https://evil.example/x.png' })

    expect(response.status).toBe(400)
    expect(mocks.transaction.user.update).not.toHaveBeenCalled()
  })
})
