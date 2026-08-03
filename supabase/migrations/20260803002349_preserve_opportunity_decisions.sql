-- A queued research run can finish after a user has acted on an opportunity.
-- Keep the human decision authoritative while still allowing fresh research to
-- update the rest of the opportunity payload atomically.
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
  next_payload jsonb;
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
    next_payload := p_payload;
    if p_object_type = 'opportunity'
      and current_object.object_type = 'opportunity'
      and current_object.payload->>'status' in ('pursue', 'nurture', 'reject')
      and exists (
        select 1
        from public.feedback_events
        where interactive_object_id = current_object.id
          and event_type in ('shortlist', 'set_status')
      )
    then
      next_payload := jsonb_set(
        p_payload,
        '{status}',
        to_jsonb(current_object.payload->>'status'),
        true
      );
    end if;

    update public.interactive_objects
    set object_type = p_object_type,
        payload = next_payload,
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
