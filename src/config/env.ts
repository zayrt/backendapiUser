import 'dotenv/config'

const port = Number(process.env.PORT ?? 3000)
const nodeEnv = process.env.NODE_ENV ?? 'development'
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT doit être un entier compris entre 1 et 65535.')
}

if (nodeEnv === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS doit contenir au moins une origine frontend en production.')
}


console.log('nodeEnv ::: ', nodeEnv)
console.log('corsOrigins ::: ', corsOrigins)
console.log('CORS ::: ', Object.freeze({
  port,
  nodeEnv,
  corsOrigins: Object.freeze(corsOrigins.length > 0
    ? corsOrigins
    : ['http://localhost:5173', 'http://127.0.0.1:5173']),
}))

export const env = Object.freeze({
  port,
  nodeEnv,
  corsOrigins: Object.freeze(corsOrigins.length > 0
    ? corsOrigins
    : ['http://localhost:5173', 'http://127.0.0.1:5173']),
})