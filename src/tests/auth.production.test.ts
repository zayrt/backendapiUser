import bcrypt from 'bcrypt'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: { account: { findUnique: vi.fn() } },
}))

vi.mock('../config/env.ts', () => ({
  env: Object.freeze({
    port: 3000,
    nodeEnv: 'production',
    isProduction: true,
    jwtSecret: 'production-test-secret-with-at-least-32-chars',
    corsOrigins: Object.freeze(['https://vueapp.vercel.app']),
  }),
}))
vi.mock('../lib/prisma.ts', () => ({ prisma: mocks.prisma }))

import app from '../app.ts'

describe('cookie de session en production (front et API sur deux domaines)', () => {
  it('pose un cookie HttpOnly; Secure; SameSite=None et l’efface avec les mêmes attributs', async () => {
    mocks.prisma.account.findUnique.mockResolvedValue({
      id: 1, name: 'Karim', email: 'karim@example.com', passwordHash: await bcrypt.hash('motdepasse-solide', 4),
    })

    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://vueapp.vercel.app')
      .send({ email: 'karim@example.com', password: 'motdepasse-solide' })
    const logout = await request(app).post('/api/auth/logout').set('Origin', 'https://vueapp.vercel.app')

    const [loginCookie] = login.headers['set-cookie'] as unknown as string[]
    const [logoutCookie] = logout.headers['set-cookie'] as unknown as string[]
    expect(login.status).toBe(200)
    expect(login.headers['access-control-allow-origin']).toBe('https://vueapp.vercel.app')
    expect(login.headers['access-control-allow-credentials']).toBe('true')
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Path=/', 'Max-Age=604800']) {
      expect(loginCookie).toContain(attribute)
    }
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Expires=Thu, 01 Jan 1970']) {
      expect(logoutCookie).toContain(attribute)
    }
  })
})
