### 1. MAKE NEW MIGRATION
`migrate create -ext sql -dir db/migrations -seq <name of migration>`

### 2. SET ENVIRONMENT IN TERMINAL
`export DATABASE_URL=<DATABASE_URL>?sslmode=disable`

### 3. SEND THE MIGRATION
`migrate -database "${DATABASE_URL}" -path db/migrations up`

### IF NO WORK CUZ SQL ERRORS:
1. fix the sql 
2. go back to a previous version
`migrate -database "${DATABASE_URL}" -path db/migrations force <version number that is good>`
3. then try again
`migrate -database "${DATABASE_URL}" -path db/migrations up `

### 4. UPDATE KYSELY-CODEGEN
`pnpm kysely-codegen` or `npm run kysely-codegen`
- for npm, need to create a script in `package.json`