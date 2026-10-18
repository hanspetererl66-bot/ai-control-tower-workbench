-- Read-only snapshot in the same JSON shape as examples/control-tower/data.json.
-- Callable only with a server-side (secret / service_role) key.
create or replace function public.control_tower_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'meta', jsonb_build_object('version', m.version, 'note', m.note, 'riskThresholdPct', m.risk_threshold_pct),
    'risks', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'severity', r.severity, 'title', r.title, 'description', r.description,
        'owner', r.owner, 'ownerTeam', r.owner_team, 'eta', r.eta, 'etaTone', r.eta_tone,
        'progressPct', r.progress_pct, 'progressColor', r.progress_color, 'progressNote', r.progress_note,
        'action', r.action, 'tile', r.tile, 'short', r.short) order by r.sort_order), '[]'::jsonb)
      from control_tower.risks r),
    'agents', jsonb_build_object(
      'total', m.agents_total, 'production', m.agents_production,
      'unregistered', m.agents_unregistered, 'overprivileged', m.agents_overprivileged,
      'types', (select coalesce(jsonb_agg(jsonb_build_object(
          'key', t.key, 'label', t.label, 'tone', t.tone, 'count', t.count,
          'description', t.description, 'examples', t.examples) order by t.sort_order), '[]'::jsonb)
        from control_tower.agent_types t),
      'discovery', (select coalesce(jsonb_agg(jsonb_build_object(
          'asset', d.asset, 'source', d.source, 'model', d.model, 'firstSeen', to_char(d.first_seen, 'YYYY-MM-DD'),
          'signalTone', d.signal_tone, 'signal', d.signal, 'statusTone', d.status_tone, 'status', d.status)
          order by d.sort_order), '[]'::jsonb)
        from control_tower.discovery_assets d),
      'discoveryMore', jsonb_build_object('note', m.discovery_more_note, 'statusTone', m.discovery_more_status_tone, 'status', m.discovery_more_status),
      'overprivilegedQueue', (select coalesce(jsonb_agg(jsonb_build_object(
          'severity', q.severity, 'name', q.name, 'count', q.count, 'description', q.description)
          order by q.sort_order), '[]'::jsonb)
        from control_tower.overprivileged_queue q),
      'overprivilegedRest', jsonb_build_object('severity', m.overprivileged_rest_severity, 'description', m.overprivileged_rest_description),
      'accessTiers', (select coalesce(jsonb_agg(jsonb_build_object(
          'label', a.label, 'count', a.count, 'color', a.color) order by a.sort_order), '[]'::jsonb)
        from control_tower.access_tiers a),
      'accessTierTarget', m.access_tier_target
    ),
    'budget', jsonb_build_object(
      'totalActualM', m.budget_total_actual_m, 'ceilingM', m.budget_ceiling_m,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object(
          'name', b.name, 'budgetK', b.budget_k, 'utilisationPct', b.utilisation_pct, 'color', b.color)
          order by b.sort_order), '[]'::jsonb)
        from control_tower.budget_groups b)
    )
  )
  from control_tower.meta m
  where m.id = 1;
$$;

revoke all on function public.control_tower_snapshot() from public, anon, authenticated;
grant execute on function public.control_tower_snapshot() to service_role;
