import type { CookieOptions } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.ts'

export const sessionCookieName = 'session'
const sessionMaxAgeMs = 7 * 24 * 60 * 60 * 1000

// Front (Vercel) et API (Render) sont sur des sites différents en production :
// le cookie doit être SameSite=None, ce qui impose Secure. En local, front et API
// partagent le site localhost, SameSite=Lax suffit et fonctionne en HTTP.
export function sessionCookieOptions(isProduction = env.isProduction): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  }
}

export function sessionCookieMaxAge(): number {
  return sessionMaxAgeMs
}

export function signSession(accountId: number): string {
  return jwt.sign({}, env.jwtSecret, {
    algorithm: 'HS256',
    subject: String(accountId),
    expiresIn: sessionMaxAgeMs / 1000,
  })
}

export function verifySession(token: unknown): number | null {
  if (typeof token !== 'string' || !token) {
    return null
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] })
    const accountId = Number(typeof payload === 'object' ? payload.sub : undefined)
    return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null
  } catch {
    return null
  }
}
