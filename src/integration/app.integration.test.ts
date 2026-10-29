import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Seul Cloudinary (service externe) est simulé : base, bcrypt, JWT, cookies et SQL sont réels.
const cloudinary = vi.hoisted(() => ({
  isCloudinaryConfigured: vi.fn(() => true),
  uploadAvatar: vi.fn(async (_image: Buffer, userId: number) =>
    `https://res.cloudinary.com/demo/image/upload/v1/vueapp/avatars/user_${userId}.png`),
  deleteAvatar: vi.fn(async () => undefined),
}))

vi.mock('../lib/cloudinary.ts', () => cloudinary)

import app from '../app.ts'
import { prisma } from '../lib/prisma.ts'

type Agent = ReturnType<typeof request.agent>

const frontend = 'http://localhost:5173'
const password = 'motdepasse-solide'
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
let agent: Agent

function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}

async function createUsers(count: number, prefix: string) {
  const ids: number[] = []
  for (let index = 1; index <= count; index++) {
    const response = await agent.post('/api/users').send({ name: `${prefix} ${index}`, email: `${prefix}${index}@example.com` })
    expect(response.status).toBe(201)
    ids.push(response.body.data.id)
  }
  return ids
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "User", "UserAuditLog", ecritures, imports_comptables, "Account" RESTART IDENTITY')
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('authentification', () => {
  it('refuse l’accès au dashboard et à l’API sans session', async () => {
    for (const path of ['/api/users', '/api/users/1', '/api/stats/users-growth', '/api/stats/users-summary', '/api/auth/me']) {
      expect((await request(app).get(path)).status).toBe(401)
    }
    expect((await request(app).post('/api/users').send({ name: 'X', email: 'x@example.com' })).status).toBe(401)
  })

  it('inscrit un compte, stocke un hash bcrypt et ouvre la session', async () => {
    agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register')
      .set('Origin', frontend)
      .send({ name: 'Admin', email: 'Admin@Example.com', password })

    expect(response.status).toBe(201)
    expect(response.body.data).toEqual({ id: 1, name: 'Admin', email: 'admin@example.com' })
    const [stored] = await prisma.$queryRaw<Array<{ password_hash: string }>>`SELECT password_hash FROM "Account"`
    expect(stored.password_hash).toMatch(/^\$2b\$/)
    expect(stored.password_hash).not.toContain(password)
    expect((await agent.get('/api/auth/me')).body.data.email).toBe('admin@example.com')
  })

  it('refuse une seconde inscription avec le même email', async () => {
    const response = await request(app).post('/api/auth/register').send({ name: 'Autre', email: 'admin@example.com', password })

    expect(response.status).toBe(409)
  })

  it('connecte avec les bons identifiants uniquement', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'mauvais' })).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ email: 'inconnu@example.com', password })).status).toBe(401)

    const otherDevice = request.agent(app)
    const login = await otherDevice.post('/api/auth/login').send({ email: 'ADMIN@example.com', password })
    expect(login.status).toBe(200)
    expect((await otherDevice.get('/api/users')).status).toBe(200)
  })

  it('ne compte pas les comptes de connexion dans le répertoire utilisateurs', async () => {
    const summary = await agent.get('/api/stats/users-summary')
    expect(summary.body.totalUsers).toBe(0)
  })
})

describe('CRUD utilisateurs', () => {
  it('crée, lit, modifie et supprime un utilisateur', async () => {
    const created = await agent.post('/api/users').set('Origin', frontend).send({ name: ' Karim ', email: 'KARIM@example.com' })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ name: 'Karim', email: 'karim@example.com', avatarUrl: null })
    const { id } = created.body.data

    expect((await agent.get(`/api/users/${id}`)).body.data.name).toBe('Karim')
    expect((await agent.post('/api/users').send({ name: 'Doublon', email: 'karim@example.com' })).status).toBe(409)

    const updated = await agent.put(`/api/users/${id}`).send({ name: 'Karim B.', email: 'karim.b@example.com' })
    expect(updated.body.data).toMatchObject({ name: 'Karim B.', email: 'karim.b@example.com' })

    expect((await agent.delete(`/api/users/${id}`)).status).toBe(204)
    expect((await agent.get(`/api/users/${id}`)).status).toBe(404)
    expect((await agent.delete(`/api/users/${id}`)).status).toBe(404)
  })

  it('refuse une écriture authentifiée venant d’une origine tierce', async () => {
    const response = await agent.post('/api/users').set('Origin', 'https://attaquant.example').send({ name: 'X', email: 'x@example.com' })
    expect(response.status).toBe(403)
  })
})

describe('pagination', () => {
  it('parcourt toutes les pages jusqu’à la dernière, puis une page au-delà', async () => {
    const ids = await createUsers(25, 'page')
    const first = await agent.get('/api/users?page=1')
    const { totalItems, totalPages } = first.body.pagination
    expect(totalItems).toBe(25)
    expect(totalPages).toBe(3)

    const seen: number[] = []
    for (let page = 1; page <= totalPages; page++) {
      const response = await agent.get(`/api/users?page=${page}`)
      expect(response.status).toBe(200)
      expect(response.body.pagination).toEqual({ currentPage: page, totalPages: 3, totalItems: 25 })
      expect(response.body.data).toHaveLength(page < totalPages ? 10 : 5)
      seen.push(...response.body.data.map((user: { id: number }) => user.id))
    }
    expect(seen).toEqual([...ids].sort((a, b) => a - b))

    const beyond = await agent.get(`/api/users?page=${totalPages + 1}`)
    expect(beyond.status).toBe(200)
    expect(beyond.body).toEqual({ data: [], pagination: { currentPage: 4, totalPages: 3, totalItems: 25 } })
    expect((await agent.get('/api/users?page=0')).status).toBe(400)
  })

  it('reste cohérente après suppression de la dernière ligne de la dernière page', async () => {
    const lastPage = await agent.get('/api/users?page=3')
    for (const user of lastPage.body.data) {
      await agent.delete(`/api/users/${user.id}`)
    }

    const response = await agent.get('/api/users?page=2')
    expect(response.body.pagination).toEqual({ currentPage: 2, totalPages: 2, totalItems: 20 })
    expect(response.body.data).toHaveLength(10)
    expect((await agent.get('/api/users?page=3')).body.data).toEqual([])
  })
})

describe('upload d’avatar', () => {
  it('stocke uniquement l’URL Cloudinary et l’expose dans la liste', async () => {
    const [user] = (await agent.get('/api/users?page=1')).body.data
    const response = await agent
      .put(`/api/users/${user.id}/avatar`)
      .set('Origin', frontend)
      .attach('avatar', png, { filename: 'photo.png', contentType: 'image/png' })

    const expectedUrl = `https://res.cloudinary.com/demo/image/upload/v1/vueapp/avatars/user_${user.id}.png`
    expect(response.status).toBe(200)
    expect(response.body.data.avatarUrl).toBe(expectedUrl)
    const [row] = await prisma.$queryRaw<Array<{ avatar_url: string }>>`SELECT avatar_url FROM "User" WHERE id = ${user.id}`
    expect(row.avatar_url).toBe(expectedUrl)
    expect((await agent.get('/api/users?page=1')).body.data[0].avatarUrl).toBe(expectedUrl)

    expect((await agent.delete(`/api/users/${user.id}`)).status).toBe(204)
    expect(cloudinary.deleteAvatar).toHaveBeenCalledWith(user.id)
  })

  it('refuse les fichiers invalides ou trop lourds et l’accès sans session', async () => {
    const [user] = (await agent.get('/api/users?page=1')).body.data
    const fake = await agent.put(`/api/users/${user.id}/avatar`).attach('avatar', Buffer.from('<svg/>'), { filename: 'x.png', contentType: 'image/png' })
    const tooLarge = await agent.put(`/api/users/${user.id}/avatar`)
      .attach('avatar', Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]), { filename: 'x.png', contentType: 'image/png' })
    const anonymous = await request(app).put(`/api/users/${user.id}/avatar`).attach('avatar', png, { filename: 'x.png', contentType: 'image/png' })

    expect([fake.status, tooLarge.status, anonymous.status]).toEqual([400, 413, 401])
  })
})

describe('statistiques : cards et graphe', () => {
  it('résume l’activité réelle sur 7 jours', async () => {
    const summary = await agent.get('/api/stats/users-summary?days=7')

    // 1 + 25 créés ; 1 (Karim) + 5 (dernière page) + 1 (avatar) supprimés ; Karim modifié par PUT, l’utilisateur à avatar par l’upload.
    expect(summary.body).toEqual({ totalUsers: 19, modifiedUsers: 2, deletedUsers: 7, period: 7 })
  })

  it('renvoie 7 points chronologiques cohérents avec le total actuel', async () => {
    const response = await agent.get('/api/stats/users-growth?days=7')
    const points = response.body.data as Array<{ date: string, total: number, created: number, updated: number, deleted: number }>

    expect(response.body).toMatchObject({ period: 7, timezone: 'Europe/Paris' })
    expect(points).toHaveLength(7)
    expect(points.at(-1)).toEqual({ date: parisToday(), total: 19, created: 26, updated: 2, deleted: 7 })
    expect(points.map((point) => point.date)).toEqual([...points.map((point) => point.date)].sort())
    for (let index = 1; index < points.length; index++) {
      expect(points[index].total).toBe(points[index - 1].total + points[index].created - points[index].deleted)
    }
    expect(points[0]).toMatchObject({ total: 0, created: 0 })
    expect((await agent.get('/api/stats/users-growth?days=366')).status).toBe(400)
  })
})

describe('déconnexion', () => {
  it('ferme la session : le dashboard et l’API redeviennent inaccessibles', async () => {
    const logout = await agent.post('/api/auth/logout').set('Origin', frontend)

    expect(logout.status).toBe(204)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
    expect((await agent.get('/api/users')).status).toBe(401)
    expect((await agent.get('/api/stats/users-summary')).status).toBe(401)
  })
})
