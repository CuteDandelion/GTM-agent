-- Version aligned with the applied remote migration ledger.
create or replace function public.apply_interactive_object_action(
  p_object_id uuid,
  p_owner_id uuid,
  p_action text,
  p_expected_revision integer,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_object public.interactive_objects%rowtype;
  next_payload jsonb;
  next_revision integer;
begin
  if p_action not in ('challenge', 'shortlist', 'correct', 'set_status') then
    raise exception 'unsupported interactive-object action';
  end if;

  select * into current_object
  from public.interactive_objects
  where id = p_object_id and owner_id = p_owner_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'object_id', p_object_id);
  end if;

  if current_object.revision <> p_expected_revision then
    return jsonb_build_object(
      'status', 'stale',
      'object_id', p_object_id,
      'current_version', current_object.revision
    );
  end if;

  next_payload := current_object.payload;
  if p_action = 'shortlist' and current_object.object_type = 'opportunity' then
    next_payload := jsonb_set(next_payload, '{status}', '"pursue"'::jsonb, true);
  elsif p_action = 'set_status' and current_object.object_type = 'opportunity' then
    if p_payload->>'status' not in ('pursue', 'research', 'nurture', 'reject') then
      raise exception 'invalid opportunity status';
    end if;
    next_payload := jsonb_set(next_payload, '{status}', to_jsonb(p_payload->>'status'), true);
  end if;

  next_revision := current_object.revision + 1;
  update public.interactive_objects
  set payload = next_payload, revision = next_revision, updated_at = now()
  where id = current_object.id;

  insert into public.feedback_events (
    owner_id,
    conversation_id,
    interactive_object_id,
    event_type,
    payload
  ) values (
    p_owner_id,
    current_object.conversation_id,
    current_object.id,
    p_action,
    coalesce(p_payload, '{}'::jsonb)
  );

  return jsonb_build_object(
    'status', 'applied',
    'object_id', current_object.id,
    'revision', next_revision
  );
end;
$$;

revoke all on function public.apply_interactive_object_action(uuid, uuid, text, integer, jsonb) from public;
revoke all on function public.apply_interactive_object_action(uuid, uuid, text, integer, jsonb) from anon;
revoke all on function public.apply_interactive_object_action(uuid, uuid, text, integer, jsonb) from authenticated;
grant execute on function public.apply_interactive_object_action(uuid, uuid, text, integer, jsonb) to service_role;
