import 'dotenv/config'
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'

const avatarFolder = 'vueapp/avatars'

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  })
}

cloudinary.config({ secure: true })

function avatarPublicId(userId: number): string {
  return `${avatarFolder}/user_${userId}`
}

export function isCloudinaryConfigured(): boolean {
  const config = cloudinary.config()
  return Boolean(config.cloud_name && config.api_key && config.api_secret)
}

export function uploadAvatar(image: Buffer, userId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: avatarPublicId(userId),
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'webp'],
        transformation: [{ width: 512, height: 512, crop: 'limit' }],
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          reject(new Error('Échec de l’upload Cloudinary.', { cause: error }))
          return
        }

        resolve(result.secure_url)
      },
    )

    stream.end(image)
  })
}

export async function deleteAvatar(userId: number): Promise<void> {
  await cloudinary.uploader.destroy(avatarPublicId(userId), { resource_type: 'image', invalidate: true })
}
