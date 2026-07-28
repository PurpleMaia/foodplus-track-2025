import dotenv from 'dotenv';
dotenv.config();
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

/** @typedef {import('../generated').DB} DB */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // The Postgres server's connection cap is shared with the deployed apps and
  // cron; long-running scripts should set DB_POOL_MAX low (e.g. 4).
  max: Number(process.env.DB_POOL_MAX) || 10,
  // Release idle connections quickly so they don't count against the server cap.
  idleTimeoutMillis: 10_000,
  // The DB is reached over Azure, whose NAT silently drops idle TCP after ~4
  // minutes; keepalives stop pooled connections from dying mid-run.
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
})

// An idle pooled client emits 'error' when its connection is dropped
// server-side; with no listener that single event crashes the process.
pool.on('error', (err) => {
  console.warn('[DB] idle client error (connection dropped, pool will replace it):', err?.message || err)
})

// pg also emits socket errors on the Client itself, even mid-query, and
// pg-pool only listens while a client sits idle in the pool — so a socket
// error on a checked-out client would crash the process. The in-flight query
// still rejects normally, so callers see an ordinary failure.
pool.on('connect', (client) => {
  client.on('error', (err) => {
    console.warn('[DB] client connection error:', err?.message || err)
  })
})

/** @type {Kysely<DB>} */
export const db = new Kysely({
  dialect: new PostgresDialect({ pool }),
})
