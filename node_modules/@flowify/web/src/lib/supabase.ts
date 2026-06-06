import PocketBase from 'pocketbase';

const defaultPocketBaseUrl = import.meta.env.VITE_POCKETBASE_URL || 'https://flowify-pocketbase.onrender.com';
const pb = new PocketBase(defaultPocketBaseUrl);

function toSupabaseError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, status: (error as any).status, code: (error as any).code };
  }
  if (typeof error === 'object' && error !== null) {
    return {
      name: String((error as any).name || 'PocketBaseError'),
      message: String((error as any).message || JSON.stringify(error)),
      status: (error as any).status,
      code: (error as any).code,
    };
  }
  return { message: String(error), name: 'PocketBaseError' };
}

function normalizeRecord(record: Record<string, any>) {
  if (!record || typeof record !== 'object') return record;
  const next = { ...record };

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

function quote(value: string) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function mapQueryField(collection: string, field: string) {
  if (collection === 'profiles' && field === 'id') return 'user_id';
  if (field === 'created_at') return '_created';
  if (field === 'updated_at') return '_updated';
  return field;
}

function toFilterValue(value: string | number | boolean) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return quote(String(value));
}

function buildEqFilter(collection: string, field: string, value: string | number | boolean) {
  return `${mapQueryField(collection, field)}=${toFilterValue(value)}`;
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
  const model = pb.authStore.model;
  return {
    user: pb.authStore.isValid && model ? mapAuthUser(model) : null,
  };
}

async function fetchList(collection: string, filters: string[], sort?: string) {
  const query: Record<string, string> = {};
  if (filters.length) {
    query.filter = filters.join(' && ');
  }
  if (sort) {
    query.sort = sort;
  }

  if (typeof pb.collection(collection).getFullList === 'function') {
    return normalizeRecords(await pb.collection(collection).getFullList(200, query));
  }

  const response = await pb.collection(collection).getList(1, 200, query);
  return normalizeRecords(response.items || []);
}

async function fetchPlaylists(filters: string[], sort?: string) {
  const playlists = await fetchList('playlists', filters, sort);
  const playlistIds = playlists.map((playlist) => playlist.id).filter(Boolean);
  const playlistMembers: Record<string, any[]> = {};
  const playlistTracks: Record<string, any[]> = {};

  if (playlistIds.length) {
    const idsFilter = `playlist_id in (${playlistIds.map((id) => quote(id)).join(',')})`;
    const members = await fetchList('playlist_members', [idsFilter]);
    const tracks = await fetchList('playlist_tracks', [idsFilter], 'position');

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
        if (this.collectionName === 'profiles') {
          const userId = String(this.upsertPayload.id || this.upsertPayload.user_id || '');
          const normalizedPayload = normalizePayload(this.collectionName, this.upsertPayload);
          const existing = await pb.collection('profiles').getList(1, 1, {
            filter: `user_id=${quote(userId)}`,
          });
          if (existing.items.length) {
            const updated = await pb.collection('profiles').update(existing.items[0].id, normalizedPayload);
            return { data: normalizeRecord(updated), error: null };
          }
          const created = await pb.collection('profiles').create(normalizedPayload);
          return { data: normalizeRecord(created), error: null };
        }
        return this.insert(this.upsertPayload).execute();
      }

      if (this.insertPayload) {
        const payload = normalizePayload(this.collectionName, this.insertPayload);
        const created = await pb.collection(this.collectionName).create(payload);
        return { data: normalizeRecord(created), error: null };
      }

      if (this.updatePayload) {
        const payload = normalizePayload(this.collectionName, this.updatePayload);
        const records = await fetchList(this.collectionName, this.filters, '');
        if (!records.length) {
          throw new Error('Record not found');
        }
        const updated = await pb.collection(this.collectionName).update(records[0].id, payload);
        return { data: normalizeRecord(updated), error: null };
      }

      if (this.shouldDelete) {
        const records = await fetchList(this.collectionName, this.filters, '');
        if (!records.length) {
          throw new Error('Record not found');
        }
        await Promise.all(records.map((record) => pb.collection(this.collectionName).delete(record.id)));
        return { data: null, error: null };
      }

      const includeNested = this.collectionName === 'playlists' && parseSelect(this.selectClause).includeTracks;
      const rows = includeNested ? await fetchPlaylists(this.filters, this.sortClause) : await fetchList(this.collectionName, this.filters, this.sortClause);
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

const auth = {
  getSession: async () => ({ data: { session: mapSession() }, error: null }),
  onAuthStateChange: (_callback: (event: string, session: any) => void) => {
    const unsubscribe = pb.authStore.onChange?.(() => {
      const session = mapSession();
      const event = session.user ? 'SIGNED_IN' : 'SIGNED_OUT';
      _callback(event, session);
    }) as (() => void) | undefined;
    return {
      data: {
        subscription: {
          unsubscribe: unsubscribe ?? (() => undefined),
        },
      },
      error: null,
    };
  },
  resetPasswordForEmail: async (email: string, _options?: any) => {
    try {
      await pb.collection('users').requestPasswordReset(email);
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
    try {
      await pb.collection('users').authWithPassword(email, password);
      const session = mapSession();
      return { data: { user: session.user, session }, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  signUp: async ({ email, password, options }: { email: string; password: string; options?: any }) => {
    try {
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        ...(options?.data || {}),
      });
      await pb.collection('users').authWithPassword(email, password);
      const session = mapSession();
      const user = session.user;
      return { data: { user, session }, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  updateUser: async ({ password }: { password: string }) => {
    try {
      const model = pb.authStore.model;
      if (!model) {
        throw new Error('No authenticated user');
      }
      await pb.collection('users').update(model.id, { password, passwordConfirm: password });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  signOut: async () => {
    pb.authStore.clear();
    return { data: null, error: null };
  },
};

const rpcHandlers: Record<string, (...args: any[]) => Promise<{ data: any; error: any }>> = {
  join_playlist_by_code: async ({ code }: { code: string }) => {
    try {
      const playlists = await fetchList('playlists', [`invite_code=${quote(code)}`]);
      const playlist = playlists[0];
      if (!playlist) {
        throw new Error('Code de playlist invalide');
      }
      const user = pb.authStore.model;
      if (!user) {
        throw new Error('Utilisateur non authentifie');
      }
      const members = await fetchList('playlist_members', [`playlist_id=${quote(playlist.id)}`, `user_id=${quote(user.id)}`]);
      if (!members.length) {
        await pb.collection('playlist_members').create({
          playlist_id: playlist.id,
          user_id: user.id,
          role: 'member',
          joined_at: new Date().toISOString(),
        });
      }
      return { data: playlist.id, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  add_track_to_playlist: async ({ target_playlist_id, track_payload, target_position }: { target_playlist_id: string; target_youtube_id?: string; target_position?: number; track_payload: any; }) => {
    try {
      const user = pb.authStore.model;
      if (!user) {
        throw new Error('Utilisateur non authentifie');
      }
      await pb.collection('playlist_tracks').create({
        playlist_id: target_playlist_id,
        added_by: user.id,
        position: target_position ?? 0,
        track: track_payload,
        created_at: new Date().toISOString(),
      });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  regenerate_playlist_invite_code: async ({ target_playlist_id }: { target_playlist_id: string }) => {
    try {
      const user = pb.authStore.model;
      if (!user) {
        throw new Error('Utilisateur non authentifie');
      }
      const playlists = await fetchList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) {
        throw new Error('Playlist introuvable');
      }
      if (playlist.owner_id !== user.id) {
        throw new Error('Permission refusee');
      }
      const inviteCode = Array.from({ length: 8 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 36))).join('');
      const updated = await pb.collection('playlists').update(playlist.id, { invite_code: inviteCode });
      return { data: updated.invite_code, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  delete_playlist: async ({ target_playlist_id }: { target_playlist_id: string }) => {
    try {
      const user = pb.authStore.model;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await fetchList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      const relatedMembers = await fetchList('playlist_members', [`playlist_id=${quote(target_playlist_id)}`]);
      await Promise.all(relatedMembers.map((member) => pb.collection('playlist_members').delete(member.id)));
      const relatedTracks = await fetchList('playlist_tracks', [`playlist_id=${quote(target_playlist_id)}`]);
      await Promise.all(relatedTracks.map((track) => pb.collection('playlist_tracks').delete(track.id)));
      await pb.collection('playlists').delete(target_playlist_id);
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  update_playlist_name: async ({ target_playlist_id, next_name }: { target_playlist_id: string; next_name: string }) => {
    try {
      const user = pb.authStore.model;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await fetchList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      await pb.collection('playlists').update(target_playlist_id, { name: next_name });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  update_playlist_member_role: async ({ target_playlist_id, target_user_id, next_role }: { target_playlist_id: string; target_user_id: string; next_role: string }) => {
    try {
      const user = pb.authStore.model;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await fetchList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id) throw new Error('Permission refusee');
      const members = await fetchList('playlist_members', [`playlist_id=${quote(target_playlist_id)}`, `user_id=${quote(target_user_id)}`]);
      if (!members.length) throw new Error('Membre introuvable');
      await pb.collection('playlist_members').update(members[0].id, { role: next_role });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  remove_playlist_member: async ({ target_playlist_id, target_user_id }: { target_playlist_id: string; target_user_id: string }) => {
    try {
      const user = pb.authStore.model;
      if (!user) throw new Error('Utilisateur non authentifie');
      const playlists = await fetchList('playlists', [`id=${quote(target_playlist_id)}`]);
      const playlist = playlists[0];
      if (!playlist) throw new Error('Playlist introuvable');
      if (playlist.owner_id !== user.id && target_user_id !== user.id) throw new Error('Permission refusee');
      const members = await fetchList('playlist_members', [`playlist_id=${quote(target_playlist_id)}`, `user_id=${quote(target_user_id)}`]);
      if (!members.length) throw new Error('Membre introuvable');
      await pb.collection('playlist_members').delete(members[0].id);
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  remove_track_from_playlist: async ({ target_playlist_id, target_youtube_id }: { target_playlist_id: string; target_youtube_id: string }) => {
    try {
      const tracks = await fetchList('playlist_tracks', [`playlist_id=${quote(target_playlist_id)}`]);
      const track = tracks.find((row) => row.id === target_youtube_id || row.track?.id === target_youtube_id);
      if (!track) {
        throw new Error('Piste introuvable');
      }
      await pb.collection('playlist_tracks').delete(track.id);
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: toSupabaseError(error) };
    }
  },
  delete_cloud_track: async ({ target_youtube_id }: { target_youtube_id: string }) => {
    try {
      const tracks = await fetchList('cloud_tracks', [`id=${quote(target_youtube_id)}`]);
      if (!tracks.length) {
        throw new Error('Fichier Cloud introuvable');
      }
      await pb.collection('cloud_tracks').delete(tracks[0].id);
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
            subscribe: () => ({ id: 'pocketbase-channel' }),
          }),
        }),
      }),
    }),
  }),
  removeChannel: (_channel?: any) => undefined,
};
