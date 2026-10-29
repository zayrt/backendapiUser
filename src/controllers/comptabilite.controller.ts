import type { RequestHandler } from 'express'
import { getBalance as fetchBalance } from '../services/balance.service.ts'
import { importEcritures } from '../services/import-ecritures.service.ts'
import { delettrer, getEcrituresCompte, lettrer } from '../services/lettrage.service.ts'

export const postImport: RequestHandler = async (req, res) => {
  const report = await importEcritures(req.file, res.locals.accountId)
  res.status(report.importId === null ? 200 : 201).json({ data: report })
}

export const getBalance: RequestHandler = async (_req, res) => {
  res.json({ data: await fetchBalance() })
}

export const getEcritures: RequestHandler = async (req, res) => {
  res.json({ data: await getEcrituresCompte(req.query.compte) })
}

export const postLettrage: RequestHandler = async (req, res) => {
  res.status(201).json({ data: await lettrer(req.body) })
}

export const removeLettrage: RequestHandler<{ compte: string, code: string }> = async (req, res) => {
  await delettrer(req.params.compte, req.params.code)
  res.status(204).send()
}
