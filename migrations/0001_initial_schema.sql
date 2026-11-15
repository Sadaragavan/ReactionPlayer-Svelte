-- Migration 0001: Initial schema (v0.0 foundation)
-- Accounts, passes, entitlements, sessions, sync profiles

-- Profiles extend Supabase auth.users
create table public.profiles (
  id uuid references auth.users not null primary key,
  display_name text,
  email text,
  nickname text, -- optional, explicitly chosen by user
  avatar_url text,
  user_tier text not null default 'free' check (user_tier in ('free', 'pro')),
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consent records (granular, versioned, revocable)
create table public.consents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  consent_type text not null, -- 'personalization', 'analytics', 'contributions', 'marketing'
  version text not null,
  granted boolean not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, consent_type, version)
);

-- Staff role grants
create table public.staff_roles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  role text not null check (role in ('support', 'moderator', 'admin', 'owner')),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, role)
);

-- Session passes (server-authoritative, 6 free per rolling 24h)
create table public.session_passes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  -- Logical content identity (reaction + source version)
  reaction_identity text not null,
  source_identity text not null,
  pass_type text not null default 'free' check (pass_type in ('free', 'pro', 'bonus', 'trial', 'gift')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  -- Idempotency key to prevent duplicate issuance for same pair within window
  idempotency_key text not null,
  unique (idempotency_key)
);

create index idx_session_passes_user_id on public.session_passes(user_id);
create index idx_session_passes_expires_at on public.session_passes(expires_at);
create index idx_session_passes_idempotency on public.session_passes(idempotency_key);

-- Entitlement grants (server-authoritative, from Stripe webhooks or admin)
create table public.entitlement_grants (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  tier text not null check (tier in ('free', 'pro')),
  source text not null check (source in ('stripe', 'trial', 'gift', 'reward', 'admin')),
  reference_id text, -- Stripe subscription ID, trial claim ID, etc.
  starts_at timestamptz not null default now(),
  ends_at timestamptz, -- null = indefinite (free tier)
  created_at timestamptz not null default now()
);

create index idx_entitlement_grants_user_id on public.entitlement_grants(user_id);
create index idx_entitlement_grants_ends_at on public.entitlement_grants(ends_at);

-- Local session references (client owns media; server stores layout/sync profile)
create table public.sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  name text not null,
  is_linked boolean not null default true,
  canvas_aspect text not null default '16:9',
  master_id text,
  clock_seconds double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_modified timestamptz not null default now()
);

create index idx_sessions_user_id on public.sessions(user_id);
create index idx_sessions_updated_at on public.sessions(updated_at);

-- Session videos (one row per video in a session)
create table public.session_videos (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  role text not null check (role in ('source', 'reaction', 'extra')),
  kind text not null check (kind in ('file', 'url')),
  title text not null,
  url text,
  file_name text,
  offset_ms integer not null default 0,
  volume double precision not null default 1,
  muted boolean not null default false,
  playback_rate double precision not null default 1,
  current_time double precision not null default 0,
  duration double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_session_videos_session_id on public.session_videos(session_id);

-- Layer transforms (layout coordinates per video)
create table public.layer_transforms (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  video_id uuid references public.session_videos(id) on delete cascade not null,
  x double precision not null,
  y double precision not null,
  w double precision not null,
  h double precision not null,
  crop_top double precision not null default 0,
  crop_right double precision not null default 0,
  crop_bottom double precision not null default 0,
  crop_left double precision not null default 0,
  opacity double precision not null default 1,
  fit text not null default 'contain' check (fit in ('contain', 'cover')),
  aspect text not null default 'auto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_layer_transforms_session_id on public.layer_transforms(session_id);

-- Sync profiles (shared, version-specific sync data for Pro cloud sync)
create table public.sync_profiles (
  id uuid default gen_random_uuid() primary key,
  reaction_identity text not null,
  source_identity text not null,
  source_version text,
  offset_ms integer not null default 0,
  confidence text not null default 'manual' check (confidence in ('manual', 'verified', 'crowd')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reaction_identity, source_identity, source_version)
);

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.consents enable row level security;
alter table public.staff_roles enable row level security;
alter table public.session_passes enable row level security;
alter table public.entitlement_grants enable row level security;
alter table public.sessions enable row level security;
alter table public.session_videos enable row level security;
alter table public.layer_transforms enable row level security;
alter table public.sync_profiles enable row level security;

-- RLS Policies: users can only access their own data
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can view own consents"
  on public.consents for select
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can insert own consents"
  on public.consents for insert
  with check (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can view own session passes"
  on public.session_passes for select
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can insert own session passes"
  on public.session_passes for insert
  with check (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can update own session passes"
  on public.session_passes for update
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can view own entitlement grants"
  on public.entitlement_grants for select
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can view own sessions"
  on public.sessions for select
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can update own sessions"
  on public.sessions for update
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can delete own sessions"
  on public.sessions for delete
  using (auth.uid() = (select id from public.profiles where id = auth.uid()));

create policy "Users can view own session videos"
  on public.session_videos for select
  using (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can insert own session videos"
  on public.session_videos for insert
  with check (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can update own session videos"
  on public.session_videos for update
  using (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can delete own session videos"
  on public.session_videos for delete
  using (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can view own layer transforms"
  on public.layer_transforms for select
  using (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can insert own layer transforms"
  on public.layer_transforms for insert
  with check (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can update own layer transforms"
  on public.layer_transforms for update
  using (auth.uid() = (select user_id from public.sessions where id = session_id));

create policy "Users can delete own layer transforms"
  on public.layer_transforms for delete
  using (auth.uid() = (select user_id from public.sessions where id = session_id));

-- Sync profiles: read for all authenticated users, write for owner
create policy "Authenticated users can view sync profiles"
  on public.sync_profiles for select
  using (auth.role() = 'authenticated');

create policy "Users can insert own sync profiles"
  on public.sync_profiles for insert
  with check (auth.uid() = created_by);

create policy "Users can update own sync profiles"
  on public.sync_profiles for update
  using (auth.uid() = created_by);

-- Staff can view all (for admin operations)
create policy "Staff can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.staff_roles sr
      where sr.user_id = auth.uid() and sr.revoked_at is null
    )
  );

create policy "Staff can view all passes"
  on public.session_passes for select
  using (
    exists (
      select 1 from public.staff_roles sr
      where sr.user_id = auth.uid() and sr.revoked_at is null
    )
  );

create policy "Staff can view all sessions"
  on public.sessions for select
  using (
    exists (
      select 1 from public.staff_roles sr
      where sr.user_id = auth.uid() and sr.revoked_at is null
    )
  );

-- Timestamp triggers
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

create trigger update_sessions_updated_at before update on public.sessions
  for each row execute function public.update_updated_at_column();

create trigger update_session_videos_updated_at before update on public.session_videos
  for each row execute function public.update_updated_at_column();

create trigger update_layer_transforms_updated_at before update on public.layer_transforms
  for each row execute function public.update_updated_at_column();

-- Sync profiles updated_at trigger
create trigger update_sync_profiles_updated_at before update on public.sync_profiles
  for each row execute function public.update_updated_at_column();
