import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const pg = await PGlite.create();
const sql = fs.readFileSync(new URL('./schema-metadata.sql', import.meta.url), 'utf8');
const proof = { tested_at_utc: new Date().toISOString(), status: 'RUNNING',
  engine: 'PGlite @electric-sql/pglite 0.5.10 (local PostgreSQL in WASM)',
  railway_connection_tested: false, production_data_used: false,
  scope: 'Catalog report under a non-owner role with no SELECT on synthetic application or migration tables.',
  checks: [] };
const check = (name, condition) => { assert.ok(condition, name); proof.checks.push(name); };
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
try {
  await pg.exec(
    "CREATE SCHEMA drizzle; " +
    "CREATE TABLE public.athlete_records (id integer PRIMARY KEY, private_note text NOT NULL); " +
    "CREATE TABLE public.training_sessions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY," +
    " athlete_id integer NOT NULL REFERENCES public.athlete_records(id), metric numeric(8,2) DEFAULT 0 CHECK(metric>=0), obsolete text); " +
    "ALTER TABLE public.training_sessions DROP COLUMN obsolete; " +
    "CREATE UNIQUE INDEX sessions_athlete_metric ON public.training_sessions(athlete_id,metric); " +
    "CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint); " +
    "INSERT INTO public.athlete_records VALUES (7,'SYNTHETIC_PRIVATE_ROW_SENTINEL_8461'); " +
    "INSERT INTO public.training_sessions(athlete_id,metric) VALUES (7,42.50); " +
    "INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('SYNTHETIC_MIGRATION_ROW_SENTINEL',1); " +
    "CREATE ROLE schema_metadata_probe NOLOGIN; " +
    "GRANT USAGE ON SCHEMA public,drizzle TO schema_metadata_probe;"
  );
  const before = await pg.query('SELECT row_to_json(a) AS item FROM public.athlete_records a ORDER BY id');
  const sessionsBefore = await pg.query('SELECT row_to_json(a) AS item FROM public.training_sessions a ORDER BY id');
  proof.postgresql_version = (await pg.query('SELECT version() AS version')).rows[0].version;
  await pg.exec('SET ROLE schema_metadata_probe');
  const privileges = (await pg.query(
    "SELECT has_table_privilege(current_user,'public.athlete_records','SELECT') AS app_select," +
    "has_table_privilege(current_user,'drizzle.__drizzle_migrations','SELECT') AS ledger_select"
  )).rows[0];
  check('probe role has no SELECT on application rows', privileges.app_select === false);
  check('probe role has no SELECT on migration ledger rows', privileges.ledger_select === false);
  for (const table of ['public.athlete_records', 'drizzle.__drizzle_migrations']) {
    let code;
    try { await pg.query('SELECT * FROM ' + table); } catch(e) { code=e.code; }
    check('actual SELECT denied for '+table, code === '42501');
  }
  const result = await pg.exec(sql);
  const metadata = result.flatMap(r=>r.rows??[]).find(r=>r.schema_metadata)?.schema_metadata;
  check('catalog report succeeds without application SELECT', !!metadata);
  check('all scoped tables reported', metadata.tables.length===3);
  check('migration ledger structure reported', metadata.columns.some(x=>x.schema==='drizzle'&&x.table==='__drizzle_migrations'&&x.column==='hash'));
  check('dropped columns excluded', !metadata.columns.some(x=>x.column==='obsolete'));
  check('typed numeric column reported', metadata.columns.some(x=>x.column==='metric'&&x.type==='numeric(8,2)'&&x.default?.includes('0')));
  check('identity property reported', metadata.columns.some(x=>x.table==='training_sessions'&&x.column==='id'&&x.identity==='a'));
  check('foreign key reported', metadata.constraints.some(x=>x.definition.startsWith('FOREIGN KEY')));
  check('check constraint reported', metadata.constraints.some(x=>x.definition.startsWith('CHECK')));
  check('unique index reported', metadata.indexes.some(x=>x.index==='sessions_athlete_metric'&&x.definition.includes('UNIQUE INDEX')));
  check('index validity, readiness and live status included', metadata.indexes.every(x=>x.is_valid===true&&x.is_ready===true&&x.is_live===true));
  check('no application or migration row sentinel in report', !JSON.stringify(metadata).includes('SENTINEL'));
  await pg.exec('RESET ROLE');
  await pg.exec('BEGIN TRANSACTION READ ONLY');
  const readable = (await pg.query('SELECT private_note FROM public.athlete_records')).rows.length;
  check('READ ONLY alone still permits row SELECT for authorized owner', readable===1);
  let writeCode;
  try { await pg.exec("UPDATE public.athlete_records SET private_note='modified' WHERE id=7"); }
  catch(e) { writeCode=e.code; }
  check('READ ONLY blocks UPDATE even for owner', writeCode==='25006');
  await pg.exec('ROLLBACK');
  const after = await pg.query('SELECT row_to_json(a) AS item FROM public.athlete_records a ORDER BY id');
  const sessionsAfter = await pg.query('SELECT row_to_json(a) AS item FROM public.training_sessions a ORDER BY id');
  check('synthetic application rows unchanged', digest(before.rows)===digest(after.rows)&&digest(sessionsBefore.rows)===digest(sessionsAfter.rows));
  proof.metadata_example = metadata;
  proof.sql_sha256 = crypto.createHash('sha256').update(sql).digest('hex');
  proof.status='PASS';
} catch(e) {
  proof.status='FAIL'; proof.error={message:e.message,code:e.code,stack:e.stack};
  process.exitCode=1;
} finally {
  await pg.close();
  const dest = new URL('./proof-result.json', import.meta.url);
  fs.writeFileSync(dest, JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({status:proof.status,checks_passed:proof.checks.length,postgresql_version:proof.postgresql_version,error:proof.error?.message}));
}

