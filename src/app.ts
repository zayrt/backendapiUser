import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.ts'
import authRoutes from './routes/auth.routes.ts'
import statsRoutes from './routes/stats.routes.ts'
import userRoutes from './routes/user.routes.ts'
import { requireAuth, requireTrustedOrigin } from './middlewares/auth.middleware.ts'
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.ts'

const app = express()

app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(null, false)
  },
  credentials: true,
}))
app.use(cookieParser())
app.use(express.json({ limit: '10kb' }))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api', requireTrustedOrigin)
app.use('/api/auth', authRoutes)
app.use('/api/stats', requireAuth, statsRoutes)
app.use('/api/users', requireAuth, userRoutes)
app.use(notFoundHandler)
app.use(errorHandler)

export default app