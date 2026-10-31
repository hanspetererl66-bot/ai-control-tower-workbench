-- The five public skill functions were callable by anon and authenticated (publishable key) from the REST API.
-- From now on every access goes through the service role (the connectors and the sync scripts with SUPABASE_SECRET_KEY).
-- skills_track wrote usage counters from outside; the others only read approved skills.
revoke all on function public.skills_list(), public.skills_get(text), public.skills_search(text, integer),
  public.skills_ranking(integer, integer), public.skills_track(text[], text, text) from public, anon, authenticated;
grant execute on function public.skills_list(), public.skills_get(text), public.skills_search(text, integer),
  public.skills_ranking(integer, integer), public.skills_track(text[], text, text) to service_role;
