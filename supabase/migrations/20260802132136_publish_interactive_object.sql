create or replace function public.publish_interactive_object(
  p_owner_id uuid,
  p_conversation_id uuid,
  p_object_key text,
  p_object_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_object public.interactive_objects%rowtype;
begin
  if p_object_key is null or length(trim(p_object_key)) = 0 or length(p_object_key) > 160 then
    raise exception 'invalid interactive-object key';
  end if;
  if p_object_type not in (
    'workflow_progress',
    'company_profile',
    'icp_score',
    'opportunity',
    'evidence_collection',
    'company_comparison',
    'interaction_prompt'
  ) then
    raise exception 'unsupported interactive-object type';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'type' is distinct from p_object_type then
    raise exception 'interactive-object payload type mismatch';
  end if;
  if not exists (
    select 1
    from public.conversations
    where id = p_conversation_id and owner_id = p_owner_id
  ) then
    raise exception 'conversation not found for owner';
  end if;

  select * into current_object
  from public.interactive_objects
  where owner_id = p_owner_id
    and conversation_id = p_conversation_id
    and object_key = p_object_key
  order by revision desc
  limit 1
  for update;

  if found then
    update public.interactive_objects
    set object_type = p_object_type,
        payload = p_payload,
        revision = current_object.revision + 1,
        updated_at = now()
    where id = current_object.id
    returning * into current_object;
  else
    insert into public.interactive_objects (
      owner_id,
      conversation_id,
      object_key,
      object_type,
      payload
    ) values (
      p_owner_id,
      p_conversation_id,
      p_object_key,
      p_object_type,
      p_payload
    )
    returning * into current_object;
  end if;

  return jsonb_build_object(
    'id', current_object.id,
    'conversation_id', current_object.conversation_id,
    'object_key', current_object.object_key,
    'object_type', current_object.object_type,
    'revision', current_object.revision,
    'payload', current_object.payload
  );
end;
$$;

revoke all on function public.publish_interactive_object(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_interactive_object(uuid, uuid, text, text, jsonb) to service_role;

-- Keep the action RPC aligned with every schema-validated client action. The
-- original function predates dynamic interaction prompts and rejected their
-- response events even though the API accepts them.
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
  if p_action not in ('challenge', 'shortlist', 'correct', 'set_status', 'respond') then
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

revoke all on function public.apply_interactive_object_action(uuid, uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_interactive_object_action(uuid, uuid, text, integer, jsonb)
  to service_role;
