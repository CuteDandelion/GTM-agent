-- Version aligned with the applied remote migration ledger.
create table public.user_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  bucket_id text not null default 'user-uploads' check (bucket_id = 'user-uploads'),
  storage_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/html',
    'application/xhtml+xml',
    'text/markdown',
    'text/plain',
    'application/json',
    'text/csv'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  content_hash text,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed', 'deleted')),
  extraction_metadata jsonb not null default '{}'::jsonb,
  openai_file_id text,
  vector_store_id text,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, storage_path)
);

create index user_documents_owner_idx on public.user_documents(owner_id);
create index user_documents_conversation_created_idx on public.user_documents(conversation_id, created_at);

alter table public.user_documents enable row level security;

create policy "user_documents_owner_all"
on public.user_documents for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on table public.user_documents to authenticated;
grant select, insert, update, delete on table public.user_documents to service_role;
revoke all on table public.user_documents from anon;

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/html',
    'application/xhtml+xml',
    'text/markdown',
    'text/plain',
    'application/json',
    'text/csv'
  ]::text[]
where id = 'user-uploads';

alter publication supabase_realtime add table public.user_documents;
