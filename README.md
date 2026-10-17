# Local PostgreSQL metadata proof

A scoped PostgreSQL catalog inventory with an AI-assisted, reviewed local permission proof. No production connection, credentials or data are used.

Run `npm ci --ignore-scripts --no-audit --no-fund` then `npm test` in this directory. Pinned dependency: official @electric-sql/pglite0.5.10. PGlite runs PostgreSQL locally in WASM; it does not establish Railway networking or production compatibility.

The test writes its synthetic result to `proof-result.json` in this directory. The SQL and proof are reusable under the included MIT license; dependency licenses remain their own.

The SQL is a scoped metadata inventory for ordinary/partitioned tables in public/drizzle. It is not full DDL or applied migration history. Defaults/constraints/index expressions can contain sensitive literals; keep real report output private.

The proof creates synthetic tables and a NOLOGIN test role only in its in-memory database, then proves catalog output succeeds while application/ledger SELECT fails. It also demonstrates READ ONLY permits authorized SELECT and rejects UPDATE. Never run the fixture/proof file against production. The SQL report itself creates no roles or permissions.

Index flags are reported, but an invalid/concurrent index fixture was not exercised. Only the18 described checks and PostgreSQL18.6 WASM engine were tested. Other schemas, views, enum/domain definitions, partition bounds, policies and triggers are outside current report.

