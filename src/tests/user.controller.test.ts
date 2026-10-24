import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getUserById: vi.fn(),
  getUsers: vi.fn(),
  updateUser: vi.fn(),
}))

const statsServices = vi.hoisted(() => ({
  getUsersGrowth: vi.fn(),
  getUsersSummary: vi.fn(),
  parseStatsPeriod: vi.fn(() => 7),
  usersGrowthTimezone: 'Europe/Paris',
}))

vi.mock('../services/user.service.ts', () => services)
vi.mock('../services/stats.service.ts', () => statsServices)

import app from '../app.ts'
import { createUser, deleteUser, getUserById, getUsers, updateUser } from '../services/user.service.ts'

const user = { id: 7, name: 'Karim', email: 'karim@example.com', avatarUrl: null }
const usersPage = { data: [user], pagination: { currentPage: 1, totalPages: 1, totalItems: 1 } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createUser).mockResolvedValue(user)
  vi.mocked(getUsers).mockResolvedValue(usersPage)
  vi.mocked(getUserById).mockResolvedValue(user)
  vi.mocked(updateUser).mockResolvedValue(user)
  vi.mocked(deleteUser).mockResolvedValue(undefined)
  statsServices.parseStatsPeriod.mockReturnValue(7)
})

describe('POST /api/users', () => {
  it('crée un utilisateur et répond 201 avec le contrat existant', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Karim', email: 'karim@example.com' })

    expect(response.status).toBe(201)
    expect(response.headers.location).toBe('/api/users/7')
    expect(response.body).toEqual({ data: user })
    expect(createUser).toHaveBeenCalledWith({ name: 'Karim', email: 'karim@example.com' })
  })

  it('retourne 400 pour un nom ou email invalide sans réponse sensible', async () => {
    vi.mocked(createUser).mockRejectedValueOnce(Object.assign(new Error('name invalide'), { statusCode: 400 }))

    const response = await request(app)
      .post('/api/users')
      .send({ name: '', email: 'bad' })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('name invalide')
  })

  it('retourne 409 pour un email déjà utilisé', async () => {
    vi.mocked(createUser).mockRejectedValueOnce(Object.assign(new Error('Cette adresse e-mail est déjà utilisée.'), { statusCode: 409 }))

    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Autre Karim', email: 'karim@example.com' })

    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe('Cette adresse e-mail est déjà utilisée.')
  })

  it('masque les détails internes des erreurs de base de données', async () => {
    vi.mocked(createUser).mockRejectedValueOnce(new Error('postgres://secret:password@db/internal'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Karim', email: 'karim@example.com' })

    expect(response.status).toBe(500)
    expect(JSON.stringify(response.body)).not.toContain('password')
    expect(response.body.error.message).toBe('Une erreur interne est survenue.')
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})

describe('routes utilisateurs existantes', () => {
  it('préserve GET, GET by id, PUT et DELETE', async () => {
    const listResponse = await request(app).get('/api/users')
    expect(listResponse.status).toBe(200)
    expect(listResponse.body).toEqual(usersPage)
    expect(getUsers).toHaveBeenCalledWith(1)
    expect((await request(app).get('/api/users/7')).status).toBe(200)

    const updateResponse = await request(app)
      .put('/api/users/7')
      .send({ name: 'Karim', email: 'karim@example.com' })
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.body).toEqual({ data: user })

    const deleteResponse = await request(app).delete('/api/users/7')
    expect(deleteResponse.status).toBe(204)
  })

  it('valide page dans GET /api/users', async () => {
    const response = await request(app).get('/api/users?page=0')

    expect(response.status).toBe(400)
    expect(response.body.error.message).toContain('page')
    expect(getUsers).not.toHaveBeenCalled()
  })

  it('passe le numéro de page à getUsers', async () => {
    const response = await request(app).get('/api/users?page=2')

    expect(response.status).toBe(200)
    expect(getUsers).toHaveBeenCalledWith(2)
  })

  it('utilise la page 1 par défaut et rejette les numéros non entiers positifs', async () => {
    const firstPage = await request(app).get('/api/users')
    expect(firstPage.status).toBe(200)
    expect(getUsers).toHaveBeenCalledWith(1)

    for (const page of ['0', '-1', '1.5', 'abc']) {
      const response = await request(app).get(`/api/users?page=${page}`)
      expect(response.status).toBe(400)
    }
  })
})
