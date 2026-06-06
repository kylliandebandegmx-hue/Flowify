const apiBase = import.meta.env.VITE_FLOWIFY_API_URL?.replace(/\/+$/, '') || window.location.origin;
const dbBase = `${apiBase}/api/db`;
const authBase = `${apiBase}/api/auth`;
const sessionStorageKey = 'flowify-auth-session';

type SessionData = { user: { id: string; email: string | null } | null; access_token?: string };

let authSession: SessionData = loadSession();
const authSubscribers = new Set<(event: string, session: any) => void>();

function loadSession(): SessionData {
  try {
    const raw = localStorage.getItem(sessionStorageKey);
    if (!raw) return { user: null };
    const value = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? value : { user: null };
  } catch {
    return { user: null };
  }
}

function saveSession() {
  try {
    localStorage.setItem(sessionStorageKey, JSON.stringify(authSession));
  } catch {
    // ignore
  }
}

function clearSession() {
  authSession = { user: null };
  try {
    localStorage.removeItem(sessionStorageKey);
  } catch {
    // ignore
  }
  publishAuthEvent('SIGNED_OUT');
}

function publishAuthEvent(event: string) {
  const session = { user: authSession.user, access_token: authSession.access_token };
  for (const callback of authSubscribers) {
    callback(event, session);
  }
}

function toSupabaseError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, status: (error as any).status, code: (error as any).code };
  }
  if (typeof error === 'object' && error !== null) {
    return {
      name: String((error as any).name || 'ApiError'),
      message: String((error as any).message || JSON.stringify(error)),
      status: (error as any).status,
      code: (error as any).code,
    };
  }
  return { message: String(error), name: 'ApiError' };
}

function normalizeRecord(record: Record<string, any>) {
  if (!record || typeof record !== 'object') return record;
  const next: Record<string, any> = { ...record };

  if ('_created' in next && !('created_at' in next)) {
    next.created_at = next._created;
  }
  if ('_updated' in next && !('updated_at' in next)) {
    next.updated_at = next._updated;
  }

  if (typeof next.track === 'string') {
    try {
      next.track = JSON.parse(next.track);
    } catch {
      // keep raw string if parse fails
    }
  }

  if (Array.isArray(next.playlist_tracks)) {
    next.playlist_tracks = next.playlist_tracks.map(normalizeRecord);
  }
  if (Array.isArray(next.playlist_members)) {
    next.playlist_members = next.playlist_members.map(normalizeRecord);
  }

  return next;
}

function normalizeRecords(records: any[]) {
  return records.map(normalizeRecord);
}

function mapQueryField(collection: string, field: string) {
  if (collection === 'profiles' && field === 'id') return 'user_id';
  return field;
}

function quote(value: string) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildEqFilter(collection: string, field: string, value: string | number | boolean) {
  return `${mapQueryField(collection, field)}=${typeof value === 'string' ? quote(value) : String(value)}`;
}

function buildInFilter(collection: string, field: string, values: string[]) {
  return `${mapQueryField(collection, field)} in (${values.map((value) => quote(value)).join(',')})`;
}

function normalizePayload(collection: string, payload: Record<string, any>) {
  const result = { ...payload };
  if (collection === 'profiles') {
    if ('id' in result) {
      result.user_id = String(result.id);
      delete result.id;
    }
    if ('user_id' in result) {
      result.user_id = String(result.user_id);
    }
  }
  if (result.track && typeof result.track === 'object') {
    result.track = JSON.parse(JSON.stringify(result.track));
  }
  return result;
}

function mapAuthUser(model: any) {
  if (!model) return null;
  return {
    id: String(model.id),
    email: model.email ?? null,
  };
}

function mapSession() {
  return {
    user: authSession.user,
    access_token: authSession.access_token,
  };
}

async function apiFetch(url: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers || {}),
  } as Record<string, string>;
  if (authSession.access_token) {
    headers.Authorization = `Bearer ${authSession.access_token}`;
  }
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw body.error || body || new Error(response.statusText);
  }
  return body;
}

async function getList(collection: string, filters: string[], sort?: string) {
  const params = new URLSearchParams();
  if (filters.length) params.set('filter', filters.join(' && '));
  if (sort) params.set('sort', sort);
  params.set('limit', '200');

  const url = `${dbBase}/${collection}?${params.toString()}`;
  const result = await apiFetch(url, { method: 'GET' });
  return normalizeRecords(result.data || []);
}

function parseSelect(selectClause: string) {
  const text = selectClause.trim();
  return {
    includeTracks: /playlist_tracks\(/.test(text),
    includeMembers: /playlist_members\(/.test(text),
  };
}

class SupabaseQuery {
  collectionName: string;
  filters: string[] = [];
  selectClause = '*';
  sortClause = '';
  insertPayload: Record<string, any> | null = null;
  updatePayload: Record<string, any> | null = null;
  upsertPayload: Record<string, any> | null = null;
  shouldSingle = false;
  shouldMaybeSingle = false;
  shouldDelete = false;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  select(selectClause: string) {
    this.selectClause = selectClause;
    return this;
  }

  eq(field: string, value: string | number | boolean) {
    this.filters.push(buildEqFilter(this.collectionName, field, value));
    return this;
  }

  in(field: string, values: string[]) {
    this.filters.push(buildInFilter(this.collectionName, field, values));
    return this;
  }

  order(field: string, options: { ascending?: boolean } = {}) {
    const mapped = mapQueryField(this.collectionName, field);
    const direction = options.ascending === false ? '-' : '';
    this.sortClause = `${direction}${mapped}`;
    return this;
  }

  insert(payload: Record<string, any>) {
    this.insertPayload = payload;
    return this;
  }

  upsert(payload: Record<string, any>) {
    this.upsertPayload = payload;
    return this;
  }

  update(payload: Record<string, any>) {
    this.updatePayload = payload;
    return this;
  }

  maybeSingle() {
    this.shouldMaybeSingle = true;
    return this;
  }

  single() {
    this.shouldSingle = true;
    return this;
  }

  delete() {
    this.shouldDelete = true;
    return this;
  }

  async execute(): Promise<{ data: any; error: any }> {
    try {
      if (this.upsertPayload) {
        const payload = normalizePayload(this.collectionName, this.upsertPayload);
        const key = this.collectionName === 'profiles' ? 'user_id' : 'id';
        const url = `${dbBase}/${this.collectionName}/upsert?key=${encodeURIComponent(key)}`;
        const result = await apiFetch(url, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { data: normalizeRecord(result.data), error: null };
      }

      if (this.insertPayload) {
        const payload = normalizePayload(this.collectionName, this.insertPayload);
        const result = await apiFetch(`${dbBase}/${this.collectionName}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { data: normalizeRecord(result.data), error: null };
      }

      if (this.updatePayload) {
        const payload = normalizePayload(this.collectionName, this.updatePayload);
        if (!this.filters.length) throw new Error('Missing filter for update');
        const url = `${dbBase}/${this.collectionName}?filter=${encodeURIComponent(this.filters.join(' && '))}`;
        const result = await apiFetch(url, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        const rows = normalizeRecords(result.data || []);
        return { data: rows, error: null };
      }

      if (this.shouldDelete) {
        if (!this.filters.length) throw new Error('Missing filter for delete');
        const url = `${dbBase}/${this.collectionName}?filter=${encodeURIComponent(this.filters.join(' && '))}`;
        await apiFetch(url, { method: 'DELETE' });
        return { data: null, error: null };
      }

      const includeNested = this.collectionName === 'playlists' && parseSelect(this.selectClause).includeTracks;
      const rows = includeNested ? await fetchPlaylists(this.filters, this.sortClause) : await getList(this.collectionName, this.filters, this.sortClause);
      if (this.shouldSingle || this.shouldMaybeSingle) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    } catch (error) {
      return { data: this.shouldSingle || this.shouldMaybeSingle ? null : [], error: toSupabaseError(error) };
    }
  }

  then(onFulfilled: (value: any) => any, onRejected?: (reason: any) => any) {
    return this.execute().then(onFulfilled, onRejected);
  }
}

async function fetchPlaylists(filters: string[], sort?: string) {
  const playlists = await getList('playlists', filters, sort);
  const playlistIds = playlists.map((playlist) => playlist.id).filter(Boolean);
  const playlistMembers: Record<string, any[]> = {};
  const playlistTracks: Record<string, any[]> = {};

  if (playlistIds.length) {
    const idsFilter = `playlist_id in (${playlistIds.map((id) => quote(id)).join(',')})`;
    const members = await getList('playlist_members', [idsFilter]);
    const tracks = await getList('playlist_tracks', [idsFilter], 'position');

    members.forEach((member) => {
      const list = playlistMembers[member.playlist_id] || [];
      list.push(member);
      playlistMembers[member.playlist_id] = list;
    });
    tracks.forEach((track) => {
      const list = playlistTracks[track.playlist_id] || [];
      list.push(track);
      playlistTracks[track.playlist_id] = list;
    });
  }

  return playlists.map((playlist) => ({
    ...playlist,
    playlist_members: playlistMembers[playlist.id] || [],
    playlist_tracks: playlistTracks[playlist.id] || [],
  }));
}

const auth = {
  getSession: async () => ({ data: { session: mapSession() }, error: null }),

  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    authSubscribers.add(callback);
    const session = { user: authSession.user, access_token: authSession.access_token };
    callback(authSession.user ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    return {
      data: {
        subscription: {
          unsubscribe: () => authSubscribers.delete(callback),
        },
      },
      error: null,
    };
  },

  resetPasswordForEmail: async (_email: string, _options?: any) => {
    return { data: null, error: { message: 'Réinitialisation de mot de passe non supportée dans cette version' } };
  },

  signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
    try {
      const result = await apiFetch(`${authBase}/signin`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      authSession = { user: mapAuthUser(result.user), access_token: result.token };
      saveSession();
      publishAuthEvent('SIGNED_IN');
      return { data: { user: authSession.user, session: mapSession() }, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },

  signUp: async ({ email, password }: { email: string; password: string; options?: any }) => {
    try {
      const result = await apiFetch(`${authBase}/signup`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      authSession = { user: mapAuthUser(result.user), access_token: result.token };
      saveSession();
      publishAuthEvent('SIGNED_IN');
      return { data: { user: authSession.user, session: mapSession() }, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },

  updateUser: async ({ password }: { password: string }) => {
    try {
      await apiFetch(`${authBase}/update-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },

  signOut: async () => {
    clearSession();
    return { data: null, error: null };
  },
};

const rpcHandlers: Record<string, (...args: any[]) => Promise<{ data: any; error: any }>> = {
  join_playlist_by_code: async ({ code }: { code: string }) => {
    try {
      const playlists = await getList('playlists', [`invite_code=${quote(code)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Code de playlist invalide');
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      const members = await getList('playlist_members', [`playlist_id=${quote(playlist.id)}`, `user_id=${quote(user.id)}`]);
      if (!members.length) {
        await apiFetch(`${dbBase}/playlist_members`, {
          method: 'POST',
          body: JSON.stringify({
            playlist_id: playlist.id,
            user_id: user.id,
            role: 'member',
            joined_at: new Date().toISOString(),
          }),
        });
      }
      return { data: playlist.id, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  add_track_to_playlist: async ({ target_playlist_id, track_payload, target_position }: { target_playlist_id: string; target_youtube_id?: string; target_position?: number; track_payload: any; }) => {
    try {
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      await apiFetch(`${dbBase}/playlist_tracks`, {
        method: 'POST',
        body: JSON.stringify({
          playlist_id: target_playlist_id,
          added_by: user.id,
          position: target_position ?? 0,
          track: track_payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  regenerate_playlist_invite_code: async ({ target_playlist_id }: { target_playlist_id: string }) => {
    try {
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await getList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      const inviteCode = Array.from({ length: 8 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 36))).join('');
      const response = await apiFetch(`${dbBase}/playlists?filter=${encodeURIComponent(`id=${quote(target_playlist_id)}`)}`, {
        method: 'PATCH',
        body: JSON.stringify({ invite_code: inviteCode }),
      });
      return { data: response.data?.[0]?.invite_code ?? inviteCode, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  delete_playlist: async ({ target_playlist_id }: { target_playlist_id: string }) => {
    try {
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await getList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      await apiFetch(`${dbBase}/playlist_members?filter=${encodeURIComponent(`playlist_id=${quote(target_playlist_id)}`)}`, { method: 'DELETE' });
      await apiFetch(`${dbBase}/playlist_tracks?filter=${encodeURIComponent(`playlist_id=${quote(target_playlist_id)}`)}`, { method: 'DELETE' });
      await apiFetch(`${dbBase}/playlists?filter=${encodeURIComponent(`id=${quote(target_playlist_id)}`)}`, { method: 'DELETE' });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  update_playlist_name: async ({ target_playlist_id, next_name }: { target_playlist_id: string; next_name: string }) => {
    try {
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await getList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      await apiFetch(`${dbBase}/playlists?filter=${encodeURIComponent(`id=${quote(target_playlist_id)}`)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: next_name }),
      });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  update_playlist_member_role: async ({ target_playlist_id, target_user_id, next_role }: { target_playlist_id: string; target_user_id: string; next_role: string }) => {
    try {
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await getList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      const members = await getList('playlist_members', [`playlist_id=${quote(target_playlist_id)}`, `user_id=${quote(target_user_id)}`]);
      if (!members.length) throw new Error('Membre introuvable');
      await apiFetch(`${dbBase}/playlist_members?filter=${encodeURIComponent(`id=${quote(members[0].id)}`)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: next_role }),
      });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  remove_playlist_member: async ({ target_playlist_id, target_user_id }: { target_playlist_id: string; target_user_id: string }) => {
    try {
      const user = authSession.user;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await getList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id && target_user_id !== user.id) throw new Error('Permission refusee');
      const members = await getList('playlist_members', [`playlist_id=${quote(target_playlist_id)}`, `user_id=${quote(target_user_id)}`]);
      if (!members.length) throw new Error('Membre introuvable');
      await apiFetch(`${dbBase}/playlist_members?filter=${encodeURIComponent(`id=${quote(members[0].id)}`)}`, { method: 'DELETE' });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  remove_track_from_playlist: async ({ target_playlist_id, target_youtube_id }: { target_playlist_id: string; target_youtube_id: string }) => {
    try {
      const tracks = await getList('playlist_tracks', [`playlist_id=${quote(target_playlist_id)}`]);
      const track = tracks.find((row) => row.id === target_youtube_id || row.track?.id === target_youtube_id);
      if (!track) throw new Error('Piste introuvable');
      await apiFetch(`${dbBase}/playlist_tracks?filter=${encodeURIComponent(`id=${quote(track.id)}`)}`, { method: 'DELETE' });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  delete_cloud_track: async ({ target_youtube_id }: { target_youtube_id: string }) => {
    try {
      const tracks = await getList('cloud_tracks', [`id=${quote(target_youtube_id)}`]);
      if (!tracks.length) throw new Error('Fichier Cloud introuvable');
      await apiFetch(`${dbBase}/cloud_tracks?filter=${encodeURIComponent(`id=${quote(tracks[0].id)}`)}`, { method: 'DELETE' });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
};

export const supabase = {
  auth,
  from: (collectionName: string) => new SupabaseQuery(collectionName),
  rpc: async (name: string, params: Record<string, any>) => {
    const handler = rpcHandlers[name];
    if (!handler) {
      return { data: null, error: { message: `RPC ${name} non supportee` } };
    }
    return handler(params);
  },
  channel: (..._args: any[]) => ({
    on: (_event?: any, _args?: any, _callback?: any) => ({
      on: (_event?: any, _args?: any, _callback?: any) => ({
        on: (_event?: any, _args?: any, _callback?: any) => ({
          on: (_event?: any, _args?: any, _callback?: any) => ({
            subscribe: () => ({ id: 'flowify-channel' }),
          }),
        }),
      }),
    }),
  }),
  removeChannel: (_channel?: any) => undefined,
};
