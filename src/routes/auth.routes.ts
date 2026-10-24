import { Router } from 'express'
import { login, logout, me, register } from '../controllers/auth.controller.ts'
import { requireAuth } from '../middlewares/auth.middleware.ts'

const router = Router()

router.post('/register', register)
router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)

export default router
