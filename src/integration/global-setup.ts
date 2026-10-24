import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { testDatabaseUrl } from './database-url.ts'

const databaseUrl = testDatabaseUrl()
const databaseName = new URL(databaseUrl).pathname.slice(1)

async function withAdminClient(run: (client: pg.Client) => Promise<unknown>) {
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'
  const client = new pg.Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await run(client)
  } finally {
    await client.end()
  }
}

async function dropDatabase() {
  await withAdminClient((client) => client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`))
}

export async function setup() {
  await dropDatabase()
  await withAdminClient((client) => client.query(`CREATE DATABASE "${databaseName}"`))
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  })
}

export async function teardown() {
  await dropDatabase()
}
