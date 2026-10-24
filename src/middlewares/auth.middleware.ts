import type { RequestHandler } from 'express'
import { env } from '../config/env.ts'
import { httpError } from '../lib/http-error.ts'
import { sessionCookieName, verifySession } from '../lib/session.ts'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export const requireAuth: RequestHandler = (req, res, next) => {
  const accountId = verifySession(req.cookies?.[sessionCookieName])

  if (!accountId) {
    next(httpError(401, 'Authentification requise.'))
    return
  }

  res.locals.accountId = accountId
  next()
}

// Le cookie SameSite=None est envoyé même depuis un site tiers : on refuse
// toute écriture dont l'origine navigateur n'est pas un frontend autorisé (CSRF).
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin')

  if (safeMethods.has(req.method) || !origin || env.corsOrigins.includes(origin)) {
    next()
    return
  }

  next(httpError(403, 'Origine non autorisée.'))
}
