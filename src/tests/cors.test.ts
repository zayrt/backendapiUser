import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../app.ts'

describe('CORS', () => {
  it('autorise le frontend local configuré', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')

    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('ne renvoie pas de permission CORS pour une origine non configurée', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://untrusted.example')

    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})