create extension if not exists pgcrypto;

alter table public.playlists
  add column if not exists invite_code text;

create or replace function public.generate_playlist_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (
      select 1
      from public.playlists p
      where p.invite_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

update public.playlists
set invite_code = public.generate_playlist_invite_code()
where invite_code is null;

alter table public.playlists
  alter column invite_code set default public.generate_playlist_invite_code(),
  alter column invite_code set not null;

create unique index if not exists playlists_invite_code_idx
  on public.playlists (invite_code);

alter table public.playlist_members
  add column if not exists joined_at timestamptz not null default now();

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

create or replace function public.regenerate_playlist_invite_code(target_playlist_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.playlists p
    where p.id = target_playlist_id
    and p.owner_id = auth.uid()
  ) then
    raise exception 'seul le proprietaire peut generer un nouveau code';
  end if;

  next_code := public.generate_playlist_invite_code();

  update public.playlists
  set invite_code = next_code
  where id = target_playlist_id;

  return next_code;
end;
$$;

grant execute on function public.regenerate_playlist_invite_code(uuid) to authenticated;
