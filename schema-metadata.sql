-- Only PostgreSQL catalog metadata is selected. No application-table rows.
-- Review schema names before use; Drizzle schema/table names may be configured.
-- Requires an already approved connection. This script makes no roles or grants.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
WITH objects AS (
  SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p')
)
SELECT jsonb_build_object(
  'tables', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', o.schema_name, 'table', o.table_name
    ) ORDER BY o.schema_name, o.table_name) FROM objects o
  ), '[]'::jsonb),
  'columns', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', o.schema_name, 'table', o.table_name, 'column', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity,
      'generated', a.attgenerated,
      'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    ) ORDER BY o.schema_name, o.table_name, a.attnum)
    FROM objects o JOIN pg_catalog.pg_attribute a ON a.attrelid = o.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
  ), '[]'::jsonb),
  'constraints', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', o.schema_name, 'table', o.table_name, 'constraint', k.conname,
      'definition', pg_catalog.pg_get_constraintdef(k.oid, true)
    ) ORDER BY o.schema_name, o.table_name, k.conname)
    FROM objects o JOIN pg_catalog.pg_constraint k ON k.conrelid = o.oid
  ), '[]'::jsonb),
  'indexes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', o.schema_name, 'table', o.table_name,
      'index', ic.relname, 'definition', pg_catalog.pg_get_indexdef(ix.indexrelid),
      'is_valid', ix.indisvalid, 'is_ready', ix.indisready, 'is_live', ix.indislive
    ) ORDER BY o.schema_name, o.table_name, ic.relname)
    FROM objects o JOIN pg_catalog.pg_index ix ON ix.indrelid = o.oid
    JOIN pg_catalog.pg_class ic ON ic.oid = ix.indexrelid
  ), '[]'::jsonb)
) AS schema_metadata;
ROLLBACK;

