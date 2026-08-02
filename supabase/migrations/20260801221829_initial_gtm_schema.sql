-- Version aligned with the applied remote migration ledger.
create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  offer_summary text not null,
  capabilities jsonb not null default '[]'::jsonb,
  proof_points jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.icp_definitions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  definition jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  seller_profile_id uuid references public.seller_profiles(id) on delete set null,
  icp_definition_id uuid references public.icp_definitions(id) on delete set null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content jsonb not null,
  sequence bigint generated always as identity,
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  canonical_name text not null,
  website_url text,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_domains (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null check (domain = lower(domain)),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, domain)
);

create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  version integer not null default 1 check (version > 0),
  dag jsonb not null,
  model_policy jsonb not null,
  tool_policy jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, name, version)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  workflow_template_id uuid not null references public.workflow_templates(id),
  status text not null default 'queued' check (status in ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  input jsonb not null,
  output jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  node_key text not null,
  agent_role text not null,
  model text not null,
  reasoning_effort text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'running', 'awaiting_approval', 'completed', 'failed', 'skipped', 'cancelled')),
  input jsonb,
  output jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id, node_key)
);

create table public.node_dependencies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  depends_on_node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (node_id <> depends_on_node_id),
  unique (node_id, depends_on_node_id)
);

create table public.node_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('running', 'completed', 'failed', 'cancelled')),
  error jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workflow_node_id, attempt_number)
);

create table public.node_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_node_id uuid not null references public.workflow_nodes(id) on delete cascade,
  node_attempt_id uuid references public.node_attempts(id) on delete set null,
  artifact_type text not null,
  schema_version integer not null default 1,
  payload jsonb not null,
  storage_path text,
  created_at timestamptz not null default now()
);

create table public.model_invocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  node_attempt_id uuid not null references public.node_attempts(id) on delete cascade,
  provider text not null default 'openai',
  model text not null,
  reasoning_effort text not null,
  request_id text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tool_invocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  node_attempt_id uuid not null references public.node_attempts(id) on delete cascade,
  tool_name text not null,
  input jsonb not null,
  output jsonb,
  status text not null check (status in ('running', 'completed', 'failed', 'denied')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  source_type text not null,
  source_url text,
  title text not null,
  observed_at timestamptz not null,
  excerpt text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  claim_text text not null,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  evidence_ids uuid[] not null default '{}',
  status text not null default 'supported' check (status in ('supported', 'contested', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.icp_assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  icp_definition_id uuid not null references public.icp_definitions(id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  pros jsonb not null default '[]'::jsonb,
  cons jsonb not null default '[]'::jsonb,
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  icp_assessment_id uuid references public.icp_assessments(id) on delete set null,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  title text not null,
  description text not null,
  value_score text not null check (value_score in ('low', 'medium', 'high')),
  effort_score text not null check (effort_score in ('low', 'medium', 'high')),
  fit_score text not null check (fit_score in ('low', 'medium', 'high')),
  shortlist_status text not null default 'unreviewed' check (shortlist_status in ('unreviewed', 'shortlisted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interactive_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  object_key text not null,
  object_type text not null,
  schema_version integer not null default 1 check (schema_version > 0),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, object_key, revision)
);

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  interactive_object_id uuid references public.interactive_objects(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index seller_profiles_owner_idx on public.seller_profiles(owner_id);
create index icp_definitions_owner_idx on public.icp_definitions(owner_id);
create index conversations_owner_idx on public.conversations(owner_id);
create index messages_conversation_idx on public.messages(conversation_id, sequence);
create index companies_owner_idx on public.companies(owner_id);
create index company_domains_company_idx on public.company_domains(company_id);
create index workflow_templates_owner_idx on public.workflow_templates(owner_id);
create index workflow_runs_owner_status_idx on public.workflow_runs(owner_id, status);
create index workflow_nodes_run_status_idx on public.workflow_nodes(workflow_run_id, status);
create index node_dependencies_run_idx on public.node_dependencies(workflow_run_id);
create index node_attempts_node_idx on public.node_attempts(workflow_node_id, attempt_number);
create index node_artifacts_node_idx on public.node_artifacts(workflow_node_id);
create index model_invocations_attempt_idx on public.model_invocations(node_attempt_id);
create index tool_invocations_attempt_idx on public.tool_invocations(node_attempt_id);
create index evidence_run_idx on public.evidence(workflow_run_id);
create index claims_run_idx on public.claims(workflow_run_id);
create index icp_assessments_company_idx on public.icp_assessments(company_id);
create index opportunities_company_idx on public.opportunities(company_id);
create index interactive_objects_conversation_idx on public.interactive_objects(conversation_id, updated_at);
create index feedback_events_conversation_idx on public.feedback_events(conversation_id, created_at);

alter table public.profiles enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.icp_definitions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.companies enable row level security;
alter table public.company_domains enable row level security;
alter table public.workflow_templates enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_nodes enable row level security;
alter table public.node_dependencies enable row level security;
alter table public.node_attempts enable row level security;
alter table public.node_artifacts enable row level security;
alter table public.model_invocations enable row level security;
alter table public.tool_invocations enable row level security;
alter table public.evidence enable row level security;
alter table public.claims enable row level security;
alter table public.icp_assessments enable row level security;
alter table public.opportunities enable row level security;
alter table public.interactive_objects enable row level security;
alter table public.feedback_events enable row level security;

create policy "profiles_owner_all" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'seller_profiles', 'icp_definitions', 'conversations', 'messages',
    'companies', 'company_domains', 'workflow_templates', 'workflow_runs',
    'workflow_nodes', 'node_dependencies', 'node_attempts', 'node_artifacts',
    'model_invocations', 'tool_invocations', 'evidence', 'claims',
    'icp_assessments', 'opportunities', 'interactive_objects', 'feedback_events'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      table_name || '_owner_all',
      table_name
    );
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
  end loop;
end
$$;

grant select, insert, update, delete on table public.profiles to authenticated;
revoke all on table public.profiles from anon;

insert into storage.buckets (id, name, public)
values
  ('research-sources', 'research-sources', false),
  ('user-uploads', 'user-uploads', false),
  ('exports', 'exports', false)
on conflict (id) do update set public = excluded.public;

create policy "private_bucket_owner_select"
on storage.objects for select to authenticated
using (
  bucket_id in ('research-sources', 'user-uploads', 'exports')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "private_bucket_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('research-sources', 'user-uploads', 'exports')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "private_bucket_owner_update"
on storage.objects for update to authenticated
using (
  bucket_id in ('research-sources', 'user-uploads', 'exports')
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id in ('research-sources', 'user-uploads', 'exports')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "private_bucket_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id in ('research-sources', 'user-uploads', 'exports')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter publication supabase_realtime add table
  public.messages,
  public.workflow_runs,
  public.workflow_nodes,
  public.interactive_objects,
  public.feedback_events;
