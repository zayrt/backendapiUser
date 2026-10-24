export type HttpError = Error & { statusCode: number, expose: true }

export function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode, expose: true as const })
}

export function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
