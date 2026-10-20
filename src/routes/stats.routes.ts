import { Router } from 'express'
import { getUsersGrowthStats, getUsersSummaryStats } from '../controllers/stats.controller.ts'

const router = Router()

router.get('/users-growth', getUsersGrowthStats)
router.get('/users-summary', getUsersSummaryStats)

export default router