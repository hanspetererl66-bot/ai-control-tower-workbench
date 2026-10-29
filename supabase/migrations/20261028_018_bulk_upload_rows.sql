-- Mass upload of tables: rows sent in batches by the Werkbank (see examples/n8n-workflows/09-bulk-table-ingest.json).
-- Safe to run more than once. The table is closed to anon and authenticated (row level security without policies);
-- only the server-side secret key (service_role), which n8n holds, can write and read it.
-- (batch_id, row_index) is the key, so sending a batch twice does not duplicate rows.
create table if not exists public.bulk_upload_rows (
  batch_id text not null check (char_length(batch_id) between 1 and 80),
  row_index integer not null check (row_index >= 0),
  source text not null default '' check (char_length(source) <= 180),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  created_at timestamptz not null default now(),
  primary key (batch_id, row_index)
);
alter table public.bulk_upload_rows enable row level security;
revoke all on public.bulk_upload_rows from anon, authenticated;
create index if not exists bulk_upload_rows_source_idx on public.bulk_upload_rows (source, created_at desc);
