create index workflow_runs_conversation_queue_idx
  on public.workflow_runs(conversation_id, status, created_at, id);

create or replace function public.claim_next_conversation_workflow_run(
  p_conversation_id uuid,
  p_worker_lease_id uuid,
  p_updated_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  next_run_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));

  select id
  into next_run_id
  from public.workflow_runs candidate
  where candidate.conversation_id = p_conversation_id
    and candidate.status = 'queued'
    and not exists (
      select 1
      from public.workflow_runs active
      where active.conversation_id = p_conversation_id
        and active.status = 'running'
    )
  order by created_at asc, id asc
  limit 1
  for update;

  if next_run_id is null then
    return null;
  end if;

  update public.workflow_runs
  set status = 'running',
      state_version = state_version + 1,
      worker_lease_id = p_worker_lease_id,
      lease_expires_at = now() + interval '15 minutes',
      started_at = coalesce(started_at, p_updated_at),
      completed_at = null,
      updated_at = p_updated_at
  where id = next_run_id
    and status = 'queued';

  if not found then
    return null;
  end if;

  return next_run_id;
end;
$$;

revoke all on function public.claim_next_conversation_workflow_run(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_next_conversation_workflow_run(uuid, uuid, timestamptz)
  to service_role;
