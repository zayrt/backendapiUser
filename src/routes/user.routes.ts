import { Router } from 'express'
import {
  getUser,
  getUsers,
  postUser,
  putUser,
  removeUser,
} from '../controllers/user.controller.ts'

const router = Router()

router.route('/').get(getUsers).post(postUser)
router.route('/:id').get(getUser).put(putUser).delete(removeUser)

export default router