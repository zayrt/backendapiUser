import type { RequestHandler } from 'express'
import multer from 'multer'

export const csvMaxBytes = 2 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: csvMaxBytes, files: 1, fields: 0 },
}).single('fichier')

export const csvUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(Object.assign(new Error('Le fichier CSV ne doit pas dépasser 2 Mo.'), { statusCode: 413 }))
      return
    }

    next(Object.assign(new Error('Envoyez un seul fichier CSV dans le champ fichier.'), { statusCode: 400 }))
  })
}
