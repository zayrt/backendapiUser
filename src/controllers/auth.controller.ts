import type { RequestHandler, Response } from 'express'
import { httpError } from '../lib/http-error.ts'
import {
  sessionCookieMaxAge,
  sessionCookieName,
  sessionCookieOptions,
  signSession,
} from '../lib/session.ts'
import { authenticate, getAccount, registerAccount, type Account } from '../services/auth.service.ts'

function startSession(res: Response, account: Account) {
  res.cookie(sessionCookieName, signSession(account.id), {
    ...sessionCookieOptions(),
    maxAge: sessionCookieMaxAge(),
  })
}

export const register: RequestHandler = async (req, res) => {
  const account = await registerAccount(req.body)
  startSession(res, account)
  res.status(201).json({ data: account })
}

export const login: RequestHandler = async (req, res) => {
  const account = await authenticate(req.body)
  startSession(res, account)
  res.json({ data: account })
}

export const logout: RequestHandler = (_req, res) => {
  res.clearCookie(sessionCookieName, sessionCookieOptions())
  res.status(204).send()
}

export const me: RequestHandler = async (_req, res) => {
  const account = await getAccount(res.locals.accountId as number)

  if (!account) {
    res.clearCookie(sessionCookieName, sessionCookieOptions())
    throw httpError(401, 'Authentification requise.')
  }

  res.json({ data: account })
}
