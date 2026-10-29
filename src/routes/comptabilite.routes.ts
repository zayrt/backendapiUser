import { Router } from 'express'
import {
  getBalance,
  getEcritures,
  postImport,
  postLettrage,
  removeLettrage,
} from '../controllers/comptabilite.controller.ts'
import { csvUpload } from '../middlewares/csv-upload.middleware.ts'

const router = Router()

router.post('/imports', csvUpload, postImport)
router.get('/balance', getBalance)
router.get('/ecritures', getEcritures)
router.post('/lettrages', postLettrage)
router.delete('/lettrages/:compte/:code', removeLettrage)

export default router
