-- Sub4Me demo tickets: close a ticket with a closing note (the evidence of what was done).
-- Until now the demo tickets could be opened and linked but never closed. public.sub4me_close_ticket sets the status
-- to Closed, stamps the date and keeps the note. It does nothing for an unknown or an already closed ticket (it says so),
-- and it never reopens or deletes. Like the other Sub4Me functions it is callable only with the server-side secret key.

alter table sub4me.tickets add column if not exists closed_on date;
alter table sub4me.tickets add column if not exists closing_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_closing_note_length' and conrelid = 'sub4me.tickets'::regclass) then
    alter table sub4me.tickets add constraint tickets_closing_note_length check (closing_note is null or char_length(closing_note) <= 1000);
  end if;
end $$;

create or replace function public.sub4me_close_ticket(p_ticket text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_ sub4me.tickets;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if note is not null and char_length(note) > 1000 then
    raise exception 'The closing note must have at most 1000 characters';
  end if;
  select * into row_ from sub4me.tickets where id = btrim(coalesce(p_ticket, '')) for update;
  if not found then
    raise exception 'Ticket % not found', btrim(coalesce(p_ticket, ''));
  end if;
  if row_.status = 'Closed' then
    raise exception 'Ticket % is already closed', row_.id;
  end if;
  update sub4me.tickets
     set status = 'Closed', updated_on = current_date, closed_on = current_date, closing_note = note
   where id = row_.id
  returning * into row_;
  return jsonb_build_object('id', row_.id, 'title', row_.title, 'product', row_.product, 'priority', row_.priority,
    'status', row_.status, 'customer', row_.customer_id, 'created', to_char(row_.created_on, 'YYYY-MM-DD'),
    'closed', to_char(row_.closed_on, 'YYYY-MM-DD'), 'closingNote', row_.closing_note);
end;
$$;

revoke all on function public.sub4me_close_ticket(text, text) from public, anon, authenticated;
grant execute on function public.sub4me_close_ticket(text, text) to service_role;
