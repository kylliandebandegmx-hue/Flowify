create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_id text not null,
  title text not null,
  channel text,
  thumbnail text,
  duration text,
  track jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, youtube_id)
);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playlist_members (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (playlist_id, user_id)
);

create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  youtube_id text not null,
  position integer not null default 0,
  track jsonb not null,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (playlist_id, youtube_id)
);

alter table public.playlists add column if not exists invite_code text;
update public.playlists
set invite_code = upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))
where invite_code is null;
alter table public.playlists
  alter column invite_code set default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  alter column invite_code set not null;
create unique index if not exists playlists_invite_code_idx
  on public.playlists (invite_code);

alter table public.playlist_tracks
  add column if not exists position integer not null default 0;

alter table public.playlist_tracks
  add column if not exists youtube_id text;

update public.playlist_tracks
set youtube_id = track->>'id'
where youtube_id is null
and track ? 'id';

create unique index if not exists playlist_tracks_playlist_youtube_idx
  on public.playlist_tracks (playlist_id, youtube_id)
  where youtube_id is not null;

alter table public.playlist_tracks
  add column if not exists added_by uuid references auth.users(id) on delete set null;

alter table public.profiles enable row level security;
alter table public.saved_tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_members enable row level security;
alter table public.playlist_tracks enable row level security;

create or replace function public.is_playlist_owner(target_playlist_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.playlists p
    where p.id = target_playlist_id
    and p.owner_id = auth.uid()
  );
$$;

create or replace function public.is_playlist_member(target_playlist_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.playlist_members pm
    where pm.playlist_id = target_playlist_id
    and pm.user_id = auth.uid()
  );
$$;

create or replace function public.can_access_playlist(target_playlist_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_playlist_owner(target_playlist_id)
    or public.is_playlist_member(target_playlist_id);
$$;

create policy "profiles are readable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "saved tracks are readable by owner"
  on public.saved_tracks for select
  using (auth.uid() = user_id);

create policy "saved tracks are insertable by owner"
  on public.saved_tracks for insert
  with check (auth.uid() = user_id);

create policy "saved tracks are deletable by owner"
  on public.saved_tracks for delete
  using (auth.uid() = user_id);

create policy "playlists are readable by members"
  on public.playlists for select
  using (auth.uid() = owner_id or public.is_playlist_member(id));

create policy "playlists are insertable by owner"
  on public.playlists for insert
  with check (auth.uid() = owner_id);

create policy "playlists are updatable by owner"
  on public.playlists for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "playlists are deletable by owner"
  on public.playlists for delete
  using (auth.uid() = owner_id);

create policy "playlist members are readable by members"
  on public.playlist_members for select
  using (public.can_access_playlist(playlist_id));

create policy "playlist members are insertable by owner"
  on public.playlist_members for insert
  with check (public.is_playlist_owner(playlist_id));

create policy "playlist members are deletable by self or owner"
  on public.playlist_members for delete
  using (auth.uid() = user_id or public.is_playlist_owner(playlist_id));

create policy "playlist tracks readable through membership"
  on public.playlist_tracks for select
  using (public.can_access_playlist(playlist_id));

create policy "playlist tracks insertable through membership"
  on public.playlist_tracks for insert
  with check (public.can_access_playlist(playlist_id));

create policy "playlist tracks deletable through membership"
  on public.playlist_tracks for delete
  using (public.can_access_playlist(playlist_id));

create or replace function public.add_owner_as_playlist_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.playlist_members (playlist_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (playlist_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists add_owner_as_playlist_member on public.playlists;
create trigger add_owner_as_playlist_member
after insert on public.playlists
for each row execute procedure public.add_owner_as_playlist_member();

create or replace function public.join_playlist_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_playlist_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.id
  into target_playlist_id
  from public.playlists p
  where upper(p.invite_code) = upper(trim(code))
  limit 1;

  if target_playlist_id is null then
    raise exception 'code invitation invalide';
  end if;

  insert into public.playlist_members (playlist_id, user_id, role)
  values (target_playlist_id, auth.uid(), 'member')
  on conflict (playlist_id, user_id) do nothing;

  return target_playlist_id;
end;
$$;

grant execute on function public.join_playlist_by_code(text) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_playlists_updated_at on public.playlists;
create trigger touch_playlists_updated_at
before update on public.playlists
for each row execute procedure public.touch_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.playlists;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.playlist_members;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.playlist_tracks;
exception
  when duplicate_object then null;
end $$;
