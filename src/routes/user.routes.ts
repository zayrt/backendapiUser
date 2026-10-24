import { Router } from 'express'
import {
  getUser,
  getUsers,
  postUser,
  putUser,
  putUserAvatar,
  removeUser,
} from '../controllers/user.controller.ts'
import { avatarUpload } from '../middlewares/avatar-upload.middleware.ts'

const router = Router()

router.route('/').get(getUsers).post(postUser)
router.route('/:id').get(getUser).put(putUser).delete(removeUser)
router.put('/:id/avatar', avatarUpload, putUserAvatar)

export default router