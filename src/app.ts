import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.ts'
import statsRoutes from './routes/stats.routes.ts'
import userRoutes from './routes/user.routes.ts'
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
}))
app.use(express.json({ limit: '10kb' }))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/stats', statsRoutes)
app.use('/api/users', userRoutes)
app.use(notFoundHandler)
app.use(errorHandler)

export default app