import type { Express } from 'express'
import request from 'supertest'
import { sessionCookieName, signSession } from '../../lib/session.ts'

export function sessionCookie(accountId = 1): string {
  return `${sessionCookieName}=${signSession(accountId)}`
}

export function authenticatedAgent(app: Express, accountId = 1) {
  return request.agent(app).set('Cookie', sessionCookie(accountId))
}
