import type { RequestHandler } from 'express'
import multer from 'multer'

export const avatarMaxBytes = 2 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: avatarMaxBytes, files: 1, fields: 0 },
}).single('avatar')

export const avatarUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(Object.assign(new Error('La photo ne doit pas dépasser 2 Mo.'), { statusCode: 413 }))
      return
    }

    next(Object.assign(new Error('Envoyez une seule image dans le champ avatar.'), { statusCode: 400 }))
  })
}
