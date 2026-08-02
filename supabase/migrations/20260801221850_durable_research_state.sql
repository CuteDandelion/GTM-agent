-- Version aligned with the applied remote migration ledger.
alter table public.workflow_runs
  add column state_version bigint not null default 1 check (state_version > 0),
  add column worker_lease_id uuid,
  add column lease_expires_at timestamptz,
  add constraint workflow_runs_id_owner_unique unique (id, owner_id);

create table public.workflow_checkpoints (
  workflow_run_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version bigint not null check (version > 0),
  checkpoint jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workflow_run_id, owner_id)
    references public.workflow_runs(id, owner_id) on delete cascade
);

create table public.research_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid not null,
  artifact_kind text not null check (artifact_kind in ('crawl_page', 'evidence')),
  artifact_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id, artifact_kind, artifact_key),
  foreign key (workflow_run_id, owner_id)
    references public.workflow_runs(id, owner_id) on delete cascade
);

create index research_artifacts_run_kind_idx
  on public.research_artifacts(workflow_run_id, artifact_kind, created_at);

alter table public.workflow_checkpoints enable row level security;
alter table public.research_artifacts enable row level security;

create policy "workflow_checkpoints_owner_all" on public.workflow_checkpoints
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "research_artifacts_owner_all" on public.research_artifacts
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select on public.workflow_checkpoints to authenticated;
grant select on public.research_artifacts to authenticated;
grant select, insert, update, delete on public.workflow_checkpoints to service_role;
grant select, insert, update, delete on public.research_artifacts to service_role;
revoke insert, update, delete on public.workflow_checkpoints from authenticated;
revoke insert, update, delete on public.research_artifacts from authenticated;
revoke all on public.workflow_checkpoints from anon;
revoke all on public.research_artifacts from anon;

create or replace function public.save_workflow_checkpoint(
  p_workflow_run_id uuid,
  p_owner_id uuid,
  p_expected_version bigint,
  p_worker_lease_id uuid,
  p_checkpoint jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_owner_id uuid;
  current_version bigint;
  resolved_status text;
  resolved_worker_lease_id uuid;
  resolved_lease_expires_at timestamptz;
begin
  select owner_id, status, worker_lease_id, lease_expires_at
  into resolved_owner_id, resolved_status, resolved_worker_lease_id, resolved_lease_expires_at
  from public.workflow_runs
  where id = p_workflow_run_id
  for update;

  if resolved_owner_id is null then
    raise exception 'workflow run % does not exist', p_workflow_run_id;
  end if;

  if resolved_owner_id <> p_owner_id then
    raise exception 'workflow run % does not belong to owner', p_workflow_run_id;
  end if;
  if resolved_status <> 'running' then
    raise exception 'workflow run % is not running', p_workflow_run_id;
  end if;
  if resolved_worker_lease_id <> p_worker_lease_id then
    raise exception 'workflow run worker lease conflict for %', p_workflow_run_id;
  end if;
  if resolved_lease_expires_at is null or resolved_lease_expires_at <= now() then
    raise exception 'workflow run worker lease expired for %', p_workflow_run_id;
  end if;

  select version into current_version
  from public.workflow_checkpoints
  where workflow_run_id = p_workflow_run_id
  for update;

  if current_version is null then
    if p_expected_version <> 0 then
      raise exception 'checkpoint version conflict for workflow run %', p_workflow_run_id;
    end if;
    insert into public.workflow_checkpoints (
      workflow_run_id,
      owner_id,
      version,
      checkpoint
    ) values (
      p_workflow_run_id,
      p_owner_id,
      1,
      p_checkpoint
    );
    update public.workflow_runs
    set lease_expires_at = now() + interval '15 minutes'
    where id = p_workflow_run_id and owner_id = p_owner_id
      and status = 'running' and worker_lease_id = p_worker_lease_id;
    if not found then
      raise exception 'workflow run worker lease conflict for %', p_workflow_run_id;
    end if;
    return 1;
  end if;

  if current_version <> p_expected_version then
    raise exception 'checkpoint version conflict for workflow run %', p_workflow_run_id;
  end if;

  update public.workflow_checkpoints
  set version = current_version + 1,
      checkpoint = p_checkpoint,
      updated_at = now()
  where workflow_run_id = p_workflow_run_id
    and owner_id = p_owner_id;

  update public.workflow_runs
  set lease_expires_at = now() + interval '15 minutes'
  where id = p_workflow_run_id and owner_id = p_owner_id
    and status = 'running' and worker_lease_id = p_worker_lease_id;
  if not found then
    raise exception 'workflow run worker lease conflict for %', p_workflow_run_id;
  end if;

  return current_version + 1;
end;
$$;

revoke all on function public.save_workflow_checkpoint(uuid, uuid, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_workflow_checkpoint(uuid, uuid, bigint, uuid, jsonb) to service_role;

create or replace function public.update_workflow_run_state(
  p_workflow_run_id uuid,
  p_owner_id uuid,
  p_expected_version bigint,
  p_worker_lease_id uuid,
  p_status text,
  p_output jsonb,
  p_updated_at timestamptz
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  current_version bigint;
  current_worker_lease_id uuid;
  current_lease_expires_at timestamptz;
begin
  select status, state_version, worker_lease_id, lease_expires_at
  into current_status, current_version, current_worker_lease_id, current_lease_expires_at
  from public.workflow_runs
  where id = p_workflow_run_id and owner_id = p_owner_id
  for update;

  if current_status is null then
    raise exception 'workflow run % does not belong to owner', p_workflow_run_id;
  end if;
  if current_version <> p_expected_version then
    raise exception 'workflow run state version conflict for %', p_workflow_run_id;
  end if;

  if current_status = p_status and p_status = 'running' then
    if current_worker_lease_id <> p_worker_lease_id then
      raise exception 'workflow run worker lease conflict for %', p_workflow_run_id;
    end if;
    update public.workflow_runs
    set lease_expires_at = now() + interval '15 minutes',
        updated_at = p_updated_at
    where id = p_workflow_run_id and owner_id = p_owner_id;
    return current_version;
  end if;

  if current_status = p_status then
    return current_version;
  end if;

  if not (
    (current_status = 'queued' and p_status in ('running', 'cancelled')) or
    (current_status = 'running' and p_status = 'cancelled') or
    (current_status = 'running' and p_status in ('completed', 'failed')
      and current_worker_lease_id = p_worker_lease_id
      and current_lease_expires_at > now()) or
    (current_status = 'running' and p_status = 'queued'
      and current_lease_expires_at <= now()) or
    (current_status in ('failed', 'cancelled') and p_status = 'queued')
  ) then
    raise exception 'invalid workflow run transition from % to %', current_status, p_status;
  end if;

  update public.workflow_runs
  set status = p_status,
      output = p_output,
      state_version = current_version + 1,
      worker_lease_id = case when p_status = 'running' then p_worker_lease_id else null end,
      lease_expires_at = case when p_status = 'running' then now() + interval '15 minutes' else null end,
      started_at = case
        when p_status = 'running' then coalesce(started_at, p_updated_at)
        else started_at
      end,
      completed_at = case
        when p_status in ('completed', 'failed', 'cancelled') then p_updated_at
        else null
      end,
      updated_at = p_updated_at
  where id = p_workflow_run_id and owner_id = p_owner_id;

  if p_status = 'cancelled' then
    update public.workflow_checkpoints
    set version = version + 1,
        checkpoint = jsonb_set(checkpoint, '{status}', '"cancelled"'::jsonb, true),
        updated_at = now()
    where workflow_run_id = p_workflow_run_id and owner_id = p_owner_id;
  end if;

  return current_version + 1;
end;
$$;

revoke all on function public.update_workflow_run_state(uuid, uuid, bigint, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_workflow_run_state(uuid, uuid, bigint, uuid, text, jsonb, timestamptz)
  to service_role;
