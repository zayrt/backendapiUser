import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    account: { create: vi.fn(), findUnique: vi.fn() },
  },
  userService: {
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    getUserById: vi.fn(),
    getUsers: vi.fn(),
    updateUser: vi.fn(),
    updateUserAvatar: vi.fn(),
  },
  statsService: {
    getUsersGrowth: vi.fn(),
    getUsersSummary: vi.fn(),
    parseStatsPeriod: vi.fn(() => 7),
    usersGrowthTimezone: 'Europe/Paris',
  },
}))

vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))
vi.mock('../services/user.service.ts', () => mocks.userService)
vi.mock('../services/stats.service.ts', () => mocks.statsService)

import app from '../app.ts'
import { env } from '../config/env.ts'
import { sessionCookieOptions } from '../lib/session.ts'
import { sessionCookie } from './helpers/auth.ts'

const account = { id: 3, name: 'Karim', email: 'karim@example.com' }
const frontend = 'http://localhost:5173'

function setCookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  return header?.find((cookie) => cookie.startsWith('session=')) ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.account.create.mockImplementation(async ({ data }: { data: { name: string, email: string } }) => ({
    id: account.id, name: data.name, email: data.email,
  }))
  mocks.prisma.account.findUnique.mockResolvedValue(account)
  mocks.userService.getUsers.mockResolvedValue({ data: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } })
  mocks.statsService.getUsersSummary.mockResolvedValue({ totalUsers: 0, modifiedUsers: 0, deletedUsers: 0 })
})

describe('POST /api/auth/register', () => {
  it('crée le compte avec un mot de passe hashé bcrypt et ouvre une session', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: '  Karim ', email: ' KARIM@example.com ', password: 'motdepasse-solide' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ data: account })
    const { data } = mocks.prisma.account.create.mock.calls[0][0]
    expect(data).toMatchObject({ name: 'Karim', email: 'karim@example.com' })
    expect(data.password).toBeUndefined()
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(data.passwordHash).not.toContain('motdepasse-solide')
    await expect(bcrypt.compare('motdepasse-solide', data.passwordHash)).resolves.toBe(true)
    expect(setCookieHeader(response)).toMatch(/^session=[^;]+;.*HttpOnly/)
  })

  it('répond 409 si l’email a déjà un compte, sans session', async () => {
    mocks.prisma.account.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }))

    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Karim', email: 'karim@example.com', password: 'motdepasse-solide' })

    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe('Un compte existe déjà avec cette adresse e-mail.')
    expect(setCookieHeader(response)).toBe('')
  })

  it.each([
    [{ name: 'Karim', email: 'karim@example.com', password: 'court' }, 'mot de passe'],
    [{ name: 'Karim', email: 'karim@example.com', password: 'é'.repeat(37) }, 'mot de passe'],
    [{ name: 'Karim', email: 'pas-un-email', password: 'motdepasse-solide' }, 'email'],
    [{ name: '', email: 'karim@example.com', password: 'motdepasse-solide' }, 'name'],
    [{ name: 'Karim', email: 'karim@example.com', password: 'motdepasse-solide', role: 'admin' }, 'champs'],
  ])('rejette une inscription invalide (%o)', async (body, expected) => {
    const response = await request(app).post('/api/auth/register').send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.message).toContain(expected)
    expect(mocks.prisma.account.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    mocks.prisma.account.findUnique.mockResolvedValue({
      ...account,
      passwordHash: await bcrypt.hash('motdepasse-solide', 4),
    })
  })

  it('ouvre une session avec un cookie httpOnly signé', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'KARIM@example.com', password: 'motdepasse-solide' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: account })
    expect(mocks.prisma.account.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'karim@example.com' } }))
    const token = /^session=([^;]+)/.exec(setCookieHeader(response))?.[1]
    expect(jwt.verify(token!, env.jwtSecret)).toMatchObject({ sub: '3' })
    expect(setCookieHeader(response)).toContain('HttpOnly')
    expect(JSON.stringify(response.body)).not.toContain('passwordHash')
  })

  it('répond 401 avec le même message pour un mauvais mot de passe ou un email inconnu', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'karim@example.com', password: 'mauvais-mot-de-passe' })
    mocks.prisma.account.findUnique.mockResolvedValue(null)
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@example.com', password: 'motdepasse-solide' })

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401)
      expect(response.body.error.message).toBe('Email ou mot de passe incorrect.')
      expect(setCookieHeader(response)).toBe('')
    }
  })

  it('répond 400 sans email ou mot de passe', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'karim@example.com' })

    expect(response.status).toBe(400)
  })
})

describe('session : /api/auth/me et /api/auth/logout', () => {
  it('renvoie le compte connecté', async () => {
    const response = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(3))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: account })
  })

  it('répond 401 et efface le cookie si le compte n’existe plus', async () => {
    mocks.prisma.account.findUnique.mockResolvedValue(null)

    const response = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(3))

    expect(response.status).toBe(401)
    expect(setCookieHeader(response)).toContain('Expires=Thu, 01 Jan 1970')
  })

  it('efface le cookie à la déconnexion, après quoi l’accès est refusé', async () => {
    const agent = request.agent(app)
    mocks.prisma.account.findUnique.mockResolvedValue({ ...account, passwordHash: await bcrypt.hash('motdepasse-solide', 4) })
    await agent.post('/api/auth/login').send({ email: 'karim@example.com', password: 'motdepasse-solide' })
    expect((await agent.get('/api/users')).status).toBe(200)

    const logout = await agent.post('/api/auth/logout')

    expect(logout.status).toBe(204)
    expect(setCookieHeader(logout)).toMatch(/session=;.*Expires=Thu, 01 Jan 1970.*HttpOnly/)
    expect((await agent.get('/api/users')).status).toBe(401)
  })
})

describe('accès refusé sans session valide', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['get', '/api/users'],
    ['get', '/api/users/1'],
    ['post', '/api/users'],
    ['put', '/api/users/1'],
    ['delete', '/api/users/1'],
    ['put', '/api/users/1/avatar'],
    ['get', '/api/stats/users-growth'],
    ['get', '/api/stats/users-summary'],
    ['get', '/api/auth/me'],
  ]

  it.each(protectedRoutes)('%s %s → 401 sans cookie', async (method, path) => {
    const response = await (request(app) as unknown as Record<string, (url: string) => request.Test>)[method](path)

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Authentification requise.')
  })

  it.each([
    ['falsifié', `${sessionCookie(3).slice(0, -4)}AAAA`],
    ['signé avec un autre secret', `session=${jwt.sign({}, 'x'.repeat(40), { subject: '3' })}`],
    ['expiré', `session=${jwt.sign({ exp: Math.floor(Date.now() / 1000) - 60 }, env.jwtSecret, { subject: '3' })}`],
    ['sans algorithme (none)', `session=${jwt.sign({}, '', { algorithm: 'none', subject: '3' })}`],
    ['avec un sujet invalide', `session=${jwt.sign({}, env.jwtSecret, { subject: 'admin' })}`],
  ])('refuse un jeton %s', async (_label, cookie) => {
    const response = await request(app).get('/api/users').set('Cookie', cookie)

    expect(response.status).toBe(401)
    expect(mocks.userService.getUsers).not.toHaveBeenCalled()
  })

  it('n’appelle aucun service métier sans session', async () => {
    await request(app).post('/api/users').send({ name: 'Karim', email: 'karim@example.com' })
    await request(app).delete('/api/users/1')

    expect(mocks.userService.createUser).not.toHaveBeenCalled()
    expect(mocks.userService.deleteUser).not.toHaveBeenCalled()
  })

  it('laisse /api/health public', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200)
  })
})

describe('CORS avec credentials et protection CSRF', () => {
  it('autorise les credentials pour le frontend configuré, y compris en preflight', async () => {
    const preflight = await request(app)
      .options('/api/users/1')
      .set('Origin', frontend)
      .set('Access-Control-Request-Method', 'DELETE')
    const response = await request(app).get('/api/health').set('Origin', frontend)

    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe(frontend)
    expect(preflight.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('refuse une écriture authentifiée venant d’une origine tierce (403)', async () => {
    const response = await request(app)
      .post('/api/users')
      .set('Cookie', sessionCookie())
      .set('Origin', 'https://attaquant.example')
      .send({ name: 'Karim', email: 'karim@example.com' })

    expect(response.status).toBe(403)
    expect(mocks.userService.createUser).not.toHaveBeenCalled()
  })

  it('accepte la même écriture depuis le frontend autorisé', async () => {
    mocks.userService.createUser.mockResolvedValue({ id: 9, name: 'Karim', email: 'karim@example.com', avatarUrl: null })

    const response = await request(app)
      .post('/api/users')
      .set('Cookie', sessionCookie())
      .set('Origin', frontend)
      .send({ name: 'Karim', email: 'karim@example.com' })

    expect(response.status).toBe(201)
  })
})

describe('options du cookie de session', () => {
  it('utilise SameSite=None; Secure en production et SameSite=Lax en local', () => {
    expect(sessionCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: 'none', path: '/' })
    expect(sessionCookieOptions(false)).toEqual({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' })
  })
})
