-- Authenticated clients may read their own server-produced records, but only
-- the API's service-role client may create or mutate those records.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workflow_templates',
    'workflow_runs',
    'workflow_nodes',
    'node_dependencies',
    'node_attempts',
    'node_artifacts',
    'model_invocations',
    'tool_invocations',
    'evidence',
    'claims',
    'icp_assessments',
    'opportunities',
    'interactive_objects',
    'feedback_events'
  ] loop
    execute format('revoke insert, update, delete on table public.%I from authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id)',
      table_name || '_owner_select',
      table_name
    );
  end loop;
end
$$;

-- These were already service-written in the durable-state migration. Repeat
-- the least-privilege boundary here so future grant changes cannot reopen it.
revoke insert, update, delete on table public.workflow_checkpoints from authenticated;
revoke insert, update, delete on table public.research_artifacts from authenticated;

-- A mobile client may register the immutable metadata of a file it just put
-- in the owner-scoped Storage bucket. Processing state, hashes, extraction
-- results, provider IDs, errors, timestamps, updates, and deletes remain
-- service-only.
revoke insert, update, delete on table public.user_documents from authenticated;
grant insert (
  id,
  owner_id,
  conversation_id,
  bucket_id,
  storage_path,
  file_name,
  mime_type,
  size_bytes,
  status
) on table public.user_documents to authenticated;

drop policy if exists "user_documents_owner_all" on public.user_documents;
create policy "user_documents_owner_select"
on public.user_documents for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "user_documents_owner_upload_insert"
on public.user_documents for insert to authenticated
with check ((select auth.uid()) = owner_id);

create or replace function public.enforce_authenticated_document_upload_registration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (
    new.status <> 'uploaded'
    or new.content_hash is not null
    or new.extraction_metadata <> '{}'::jsonb
    or new.openai_file_id is not null
    or new.vector_store_id is not null
    or new.error is not null
    or new.deleted_at is not null
  ) then
    raise insufficient_privilege using
      message = 'authenticated clients may only register unprocessed document uploads';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_document_upload_registration()
  from public, anon, authenticated;

drop trigger if exists enforce_authenticated_document_upload_registration
  on public.user_documents;
create trigger enforce_authenticated_document_upload_registration
before insert on public.user_documents
for each row execute function public.enforce_authenticated_document_upload_registration();
