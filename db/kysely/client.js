import dotenv from 'dotenv';
dotenv.config();
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

/** @typedef {import('../generated').DB} DB */

/** @type {Kysely<DB>} */
export const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  }),
})