import 'dotenv/config'

// Base dédiée aux tests d'intégration : TEST_DATABASE_URL, sinon DATABASE_URL suffixée par _test.
export function testDatabaseUrl(): string {
  const configured = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!configured) {
    throw new Error('Définissez TEST_DATABASE_URL ou DATABASE_URL pour lancer les tests d’intégration.')
  }

  const url = new URL(configured)
  if (!process.env.TEST_DATABASE_URL) {
    url.pathname = `${url.pathname.replace(/_test$/, '')}_test`
  }

  if (!url.pathname.endsWith('_test')) {
    throw new Error('Par sécurité, le nom de la base de test doit se terminer par _test.')
  }

  return url.toString()
}
