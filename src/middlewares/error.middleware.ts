import type { ErrorRequestHandler, RequestHandler } from 'express'

type HttpError = Error & {
  statusCode?: number
  status?: number
  type?: string
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(Object.assign(new Error(`Route introuvable : ${req.method} ${req.originalUrl}`), { statusCode: 404 }))
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    return next(error)
  }

  const requestError: HttpError = error instanceof Error
    ? error as HttpError
    : Object.assign(new Error('Erreur inconnue.'), {})
  const statusCode = requestError.statusCode ?? requestError.status ?? (requestError.type === 'entity.parse.failed' ? 400 : 500)
  const message = statusCode >= 500
    ? 'Une erreur interne est survenue.'
    : requestError.type === 'entity.parse.failed'
      ? 'Le JSON envoyé est invalide.'
      : requestError.type === 'entity.too.large'
        ? 'Le corps de la requête dépasse la limite de 10 Ko.'
        : requestError.message

  if (statusCode >= 500) {
    console.error(requestError)
  }

  res.status(statusCode).json({ error: { message } })
}