import type { RequestHandler } from 'express'
import {
  createUser,
  deleteUser,
  getUsers as fetchUsers,
  getUserById,
  updateUser,
  updateUserAvatar,
} from '../services/user.service.ts'

function parsePage(value: unknown): number {
  if (value === undefined) {
    return 1
  }

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw Object.assign(new Error('page doit être un entier strictement positif.'), { statusCode: 400 })
  }

  const page = Number(value)
  if (!Number.isSafeInteger(page)) {
    throw Object.assign(new Error('page doit être un entier strictement positif.'), { statusCode: 400 })
  }

  return page
}

export const getUsers: RequestHandler = async (_req, res) => {
  const page = parsePage(_req.query.page)
  res.json(await fetchUsers(page))
}

export const getUser: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ data: await getUserById(req.params.id) })
}

export const postUser: RequestHandler = async (req, res) => {
  const user = await createUser(req.body)
  res.location(`/api/users/${user.id}`).status(201).json({ data: user })
}

export const putUser: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ data: await updateUser(req.params.id, req.body) })
}

export const putUserAvatar: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ data: await updateUserAvatar(req.params.id, req.file) })
}

export const removeUser: RequestHandler<{ id: string }> = async (req, res) => {
  await deleteUser(req.params.id)
  res.status(204).send()
}