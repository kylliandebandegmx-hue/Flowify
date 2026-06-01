import type { Session, User } from '@supabase/supabase-js';
import {
  CircleAlert,
  Cloud,
  Copy,
  Download,
  Heart,
  Home,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  Pause,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  clearYoutubeApiKey,
  clearFlowifyApiBaseUrl,
  cloudStreamUrl,
  deleteCloudTrackObject,
  downloadTrack,
  getFlowifyApiBaseUrl,
  getHealth,
  getTrending,
  getYoutubeApiKey,
  hasYtdlpAudioApi,
  resolveYouTubeUrl,
  saveFlowifyApiBaseUrl,
  saveYoutubeApiKey,
  searchTracks,
  streamUrl,
  uploadCloudTrack,
} from './lib/api';
import { isStandaloneDisplay } from './lib/pwa';
import { supabase } from './lib/supabase';
import type {
  ApiHealth,
  CloudTrackRow,
  Playlist,
  PlaylistRow,
  SavedTrackRow,
  Track,
} from './types';

type ViewMode = 'home' | 'search' | 'library' | 'cloud' | 'playlists' | 'settings';
type AuthMode = 'signin' | 'signup';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const user = session?.user || null;

  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [savedTracks, setSavedTracks] = useState<Track[]>([]);
  const [cloudTracks, setCloudTracks] = useState<Track[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [settingsYoutubeKey, setSettingsYoutubeKey] = useState(() => getYoutubeApiKey());
  const [settingsFlowifyApiUrl, setSettingsFlowifyApiUrl] = useState(() => getFlowifyApiBaseUrl());
  const [hasYoutubeKey, setHasYoutubeKey] = useState(() => Boolean(getYoutubeApiKey()));
  const [hasFlowifyApi, setHasFlowifyApi] = useState(() => hasYtdlpAudioApi());
  const [nextPageToken, setNextPageToken] = useState('');
  const [view, setView] = useState<ViewMode>('home');
  const [loading, setLoading] = useState(false);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [downloadBusy, setDownloadBusy] = useState<Record<string, boolean>>({});
  const [cloudDeleteBusy, setCloudDeleteBusy] = useState<Record<string, boolean>>({});
  const [cloudUploadBusy, setCloudUploadBusy] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);

  const activePlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === activePlaylistId) || null,
    [activePlaylistId, playlists],
  );

  const visibleTracks =
    view === 'library'
      ? savedTracks
      : view === 'cloud'
        ? cloudTracks
      : view === 'playlists'
        ? activePlaylist?.tracks || []
        : tracks;

  const playlistTarget = activePlaylist || playlists[0] || null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    setStandalone(isStandaloneDisplay());
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const nextHealth = await getHealth();
      setHealth(nextHealth);
      setHasFlowifyApi(hasYtdlpAudioApi());
      setSettingsFlowifyApiUrl((current) => current || getFlowifyApiBaseUrl());
    } catch {
      setHealth({ ok: false, youtubeConfigured: false, ytdlpAvailable: false, apiReachable: false });
      setHasFlowifyApi(hasYtdlpAudioApi());
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadTrending = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const result = await getTrending();
      setTracks(result.tracks);
      setNextPageToken('');
      setView('home');
    } catch (error) {
      setMessage(errorMessage(error));
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSavedTracks = useCallback(async (activeUser: User) => {
    const { data, error } = await supabase
      .from('saved_tracks')
      .select('*')
      .eq('user_id', activeUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    const rows = (data || []) as SavedTrackRow[];
    const saved = rows.map((row) => row.track);
    setSavedTracks(saved);
    setSavedIds(new Set(saved.map((track) => track.id)));
  }, []);

  const loadCloudTracks = useCallback(async (activeUser: User) => {
    const { data, error } = await supabase
      .from('cloud_tracks')
      .select('*')
      .eq('user_id', activeUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      setMessage(errorMessage(error));
      return;
    }

    const rows = (data || []) as CloudTrackRow[];
    setCloudTracks(rows.map((row) => ({
      ...row.track,
      source: 'cloud',
      storageKey: row.storage_key,
      fileName: row.file_name,
      contentType: row.content_type || row.track.contentType,
      sizeBytes: row.size_bytes || row.track.sizeBytes,
    })));
  }, []);

  const loadPlaylists = useCallback(async (_activeUser: User) => {
    const { data, error } = await supabase
      .from('playlists')
      .select(
        'id, owner_id, name, invite_code, created_at, updated_at, playlist_tracks(id, playlist_id, track, created_at), playlist_members(playlist_id, user_id, role)',
      )
      .order('updated_at', { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    const rows = (data || []) as unknown as PlaylistRow[];
    const mapped = rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      inviteCode: row.invite_code,
      memberCount: row.playlist_members?.length || 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tracks: [...(row.playlist_tracks || [])]
        .sort((a, b) => {
          const byPosition = (a.position || 0) - (b.position || 0);
          if (byPosition !== 0) return byPosition;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        })
        .map((trackRow) => trackRow.track)
        .filter(Boolean),
    }));

    setPlaylists(mapped);
    setActivePlaylistId((current) => {
      if (current && mapped.some((playlist) => playlist.id === current)) {
        return current;
      }
      return mapped[0]?.id || '';
    });
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    if (!user) return;
    loadSavedTracks(user);
    loadCloudTracks(user);
    loadPlaylists(user);
    loadTrending();
  }, [loadCloudTracks, loadSavedTracks, loadPlaylists, loadTrending, user]);

  useEffect(() => {
    if (!user) return undefined;

    const reloadPlaylists = () => {
      void loadPlaylists(user);
    };

    const channel = supabase
      .channel(`flowify-playlists-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, reloadPlaylists)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_members' }, reloadPlaylists)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_tracks' }, reloadPlaylists)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPlaylists, user]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setMessage('');
    try {
      const result =
        authMode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) throw result.error;
      if (authMode === 'signup' && result.data.user) {
        await supabase.from('profiles').upsert({
          id: result.data.user.id,
          email,
          display_name: email.split('@')[0],
        });
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSavedTracks([]);
    setCloudTracks([]);
    setSavedIds(new Set());
    setPlaylists([]);
    setTracks([]);
    setCurrentTrack(null);
    setPlaying(false);
  };

  const submitSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    setLoading(true);
    setMessage('');
    try {
      const result = cleanQuery.includes('youtu')
        ? await resolveYouTubeUrl(cleanQuery)
        : await searchTracks(cleanQuery);
      setTracks(result.tracks);
      setNextPageToken(result.nextPageToken || '');
      setView('search');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextPageToken || loading || !query.trim()) return;
    setLoading(true);
    try {
      const result = await searchTracks(query.trim(), nextPageToken);
      setTracks((previous) => [...previous, ...result.tracks]);
      setNextPageToken(result.nextPageToken || '');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const createPlaylist = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !newPlaylistName.trim()) return;

    setPlaylistBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase
        .from('playlists')
        .insert({ owner_id: user.id, name: newPlaylistName.trim() })
        .select('id')
        .single();

      if (error) throw error;
      setNewPlaylistName('');
      await loadPlaylists(user);
      if (data?.id) {
        setActivePlaylistId(data.id);
        setView('playlists');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const joinPlaylist = async (event: FormEvent) => {
    event.preventDefault();
    const cleanCode = joinCode.trim().replace(/\s+/g, '').toUpperCase();
    if (!user || !cleanCode) return;

    setPlaylistBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('join_playlist_by_code', {
        code: cleanCode,
      });
      if (error) throw error;
      setJoinCode('');
      await loadPlaylists(user);
      if (data) {
        setActivePlaylistId(String(data));
        setView('playlists');
        setMessage('Playlist rejointe.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const uploadCloudFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!user || !file) return;
    if (!file.type.startsWith('audio/')) {
      setMessage('Choisis un fichier audio.');
      return;
    }

    setCloudUploadBusy(true);
    setMessage('Upload Cloud en cours...');
    try {
      const uploaded = await uploadCloudTrack(file);
      const track: Track = {
        id: `cloud:${uploaded.key}`,
        title: titleFromFile(uploaded.fileName || file.name),
        channel: 'Cloud Flowify',
        thumbnail: '',
        duration: '',
        viewCount: '',
        publishedAt: new Date().toISOString(),
        description: 'Musique importee dans Flowify Cloud',
        source: 'cloud',
        storageKey: uploaded.key,
        fileName: uploaded.fileName || file.name,
        contentType: uploaded.contentType || file.type,
        sizeBytes: uploaded.sizeBytes || file.size,
        url: uploaded.url || '',
      };

      const { error } = await supabase.from('cloud_tracks').insert({
        user_id: user.id,
        storage_key: uploaded.key,
        title: track.title,
        file_name: track.fileName,
        content_type: track.contentType,
        size_bytes: track.sizeBytes,
        track,
      });
      if (error) throw error;

      await loadCloudTracks(user);
      setView('cloud');
      setMessage('Musique ajoutee au Cloud.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setCloudUploadBusy(false);
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    saveYoutubeApiKey(settingsYoutubeKey);
    if (settingsFlowifyApiUrl.trim()) {
      saveFlowifyApiBaseUrl(settingsFlowifyApiUrl);
    } else {
      clearFlowifyApiBaseUrl();
    }
    setSettingsYoutubeKey(getYoutubeApiKey());
    setSettingsFlowifyApiUrl(getFlowifyApiBaseUrl());
    setHasYoutubeKey(Boolean(getYoutubeApiKey()));
    setHasFlowifyApi(hasYtdlpAudioApi());
    setMessage('Parametres sauvegardes.');
    await refreshHealth();
    if (user) await loadTrending();
  };

  const removeYoutubeKey = async () => {
    clearYoutubeApiKey();
    setSettingsYoutubeKey('');
    setHasYoutubeKey(false);
    setMessage('Cle YouTube supprimee de cet appareil.');
    await refreshHealth();
  };

  const removeFlowifyApiUrl = async () => {
    clearFlowifyApiBaseUrl();
    setSettingsFlowifyApiUrl(getFlowifyApiBaseUrl());
    setHasFlowifyApi(hasYtdlpAudioApi());
    setMessage('URL API Flowify supprimee de cet appareil.');
    await refreshHealth();
  };

  const regenerateInviteCode = async (playlist: Playlist | null) => {
    if (!user || !playlist) return;
    setPlaylistBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('regenerate_playlist_invite_code', {
        target_playlist_id: playlist.id,
      });
      if (error) throw error;
      setMessage(`Nouveau code: ${String(data)}`);
      await loadPlaylists(user);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const deletePlaylist = async (playlist: Playlist | null) => {
    if (!user || !playlist || playlist.ownerId !== user.id) return;
    const confirmed = window.confirm(`Supprimer la playlist "${playlist.name}" ?`);
    if (!confirmed) return;

    setPlaylistBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('delete_playlist', {
        target_playlist_id: playlist.id,
      });

      if (error) throw error;
      if (activePlaylistId === playlist.id) setActivePlaylistId('');
      setMessage(`Playlist supprimee: ${playlist.name}`);
      await loadPlaylists(user);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const addTrackToPlaylist = async (track: Track, playlist = playlistTarget) => {
    if (!user || !playlist) {
      setMessage('Cree ou rejoins une playlist avant d ajouter un titre.');
      return;
    }

    const position = playlist.tracks.length
      ? playlist.tracks.length * 1000 + 1000
      : 1000;
    const { error } = await supabase.rpc('add_track_to_playlist', {
      target_playlist_id: playlist.id,
      target_youtube_id: track.id,
      target_position: position,
      track_payload: track,
    });

    if (error) {
      setMessage(errorMessage(error));
      return;
    }

    setActivePlaylistId(playlist.id);
    setMessage(`Ajoute dans ${playlist.name}`);
    await loadPlaylists(user);
  };

  const removeTrackFromPlaylist = async (track: Track) => {
    if (!user || !activePlaylist) return;

    const { error } = await supabase.rpc('remove_track_from_playlist', {
      target_playlist_id: activePlaylist.id,
      target_youtube_id: track.id,
    });

    if (error) {
      setMessage(errorMessage(error));
      return;
    }
    await loadPlaylists(user);
  };

  const deleteCloudTrack = async (track: Track) => {
    if (!user || track.source !== 'cloud' || !track.storageKey) return;
    const confirmed = window.confirm(`Supprimer "${track.title}" du Cloud ?`);
    if (!confirmed) return;

    setCloudDeleteBusy((previous) => ({ ...previous, [track.id]: true }));
    setMessage('');
    try {
      const { error } = await supabase.rpc('delete_cloud_track', {
        target_storage_key: track.storageKey,
      });
      if (error) throw error;

      await deleteCloudTrackObject(track.storageKey);
      setCloudTracks((previous) => previous.filter((item) => item.id !== track.id));
      setSavedTracks((previous) => previous.filter((item) => item.id !== track.id));
      setSavedIds((previous) => {
        const copy = new Set(previous);
        copy.delete(track.id);
        return copy;
      });
      if (currentTrack?.id === track.id) {
        audioRef.current?.pause();
        audioRef.current?.removeAttribute('src');
        setCurrentTrack(null);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }
      await loadCloudTracks(user);
      await loadSavedTracks(user);
      await loadPlaylists(user);
      setMessage('Musique Cloud supprimee.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setCloudDeleteBusy((previous) => ({ ...previous, [track.id]: false }));
    }
  };

  const copyInviteCode = async (playlist: Playlist | null) => {
    if (!playlist) return;
    await navigator.clipboard?.writeText(playlist.inviteCode);
    setMessage(`Code copie: ${playlist.inviteCode}`);
  };

  const openPlaylist = (playlist: Playlist) => {
    setActivePlaylistId(playlist.id);
    setView('playlists');
  };

  const playTrack = async (track: Track, list = visibleTracks, index = 0) => {
    const audio = audioRef.current;

    setCurrentTrack(track);
    setQueue(list);
    setQueueIndex(index);
    setMessage('');
    setCurrentTime(0);
    setDuration(parseDisplayDuration(track.duration));

    const isCloudTrack = track.source === 'cloud';
    const apiConfigured = hasYtdlpAudioApi();
    if (!apiConfigured) {
      setPlaying(false);
      setMessage('API Flowify non joignable: verifie l URL dans Parametres.');
      return;
    }

    if (!audio) return;
    const source = isCloudTrack ? cloudStreamUrl(track) : streamUrl(track);
    if (!source) {
      setPlaying(false);
      setMessage(isCloudTrack ? 'Fichier Cloud introuvable.' : 'Source yt-dlp introuvable.');
      return;
    }
    setMessage(isCloudTrack ? 'Preparation audio Cloud...' : 'Preparation audio yt-dlp...');

    try {
      await probeAudioSource(source);
      setMessage('');
      getHealth().then((nextHealth) => {
        setHealth(nextHealth);
        setHasFlowifyApi(hasYtdlpAudioApi());
        setSettingsFlowifyApiUrl((current) => current || getFlowifyApiBaseUrl());
      }).catch(() => undefined);
    } catch (error) {
      setPlaying(false);
      setMessage(errorMessage(error));
      return;
    }

    audio.pause();
    audio.removeAttribute('src');
    audio.preload = 'metadata';
    audio.src = source;
    audio.load();
    try {
      await audio.play();
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      setMessage(errorMessage(error));
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!currentTrack) return;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const playOffset = (offset: number) => {
    if (!queue.length) return;
    const nextIndex = queueIndex + offset;
    if (nextIndex < 0 || nextIndex >= queue.length) return;
    playTrack(queue[nextIndex], queue, nextIndex);
  };

  const toggleSave = async (track: Track) => {
    if (!user) return;

    if (savedIds.has(track.id)) {
      const { error } = await supabase
        .from('saved_tracks')
        .delete()
        .eq('user_id', user.id)
        .eq('youtube_id', track.id);
      if (error) {
        setMessage(error.message);
        return;
      }
      setSavedTracks((previous) => previous.filter((item) => item.id !== track.id));
      setSavedIds((previous) => {
        const copy = new Set(previous);
        copy.delete(track.id);
        return copy;
      });
      return;
    }

    const { error } = await supabase.from('saved_tracks').insert({
      user_id: user.id,
      youtube_id: track.id,
      title: track.title,
      channel: track.channel,
      thumbnail: track.thumbnail,
      duration: track.duration,
      track,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setSavedTracks((previous) => [track, ...previous]);
    setSavedIds((previous) => new Set(previous).add(track.id));
  };

  const requestDownload = async (track: Track) => {
    setDownloadBusy((previous) => ({ ...previous, [track.id]: true }));
    setMessage('');
    try {
      await downloadTrack(track);
      setMessage('Titre telecharge via yt-dlp');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setDownloadBusy((previous) => ({ ...previous, [track.id]: false }));
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setStandalone(isStandaloneDisplay());
  };

  const statusLabel = useMemo(() => {
    if (healthLoading) return 'Verification';
    if (!hasYoutubeKey && health?.apiReachable && health.cloudStorageAvailable) return 'Cloud pret, cle YouTube manquante';
    if (!hasYoutubeKey) return 'Cle YouTube manquante';
    if (!health?.youtubeConfigured) return 'YouTube non configure';
    if (health.ytdlpAvailable && health.cloudStorageAvailable) return 'YouTube + Cloud prets';
    if (health.ytdlpAvailable) return 'YouTube + yt-dlp prets';
    if (health.apiReachable && health.cloudStorageAvailable) return 'Cloud pret, yt-dlp indisponible';
    if (hasFlowifyApi && health.apiReachable) return 'API Flowify OK, yt-dlp indisponible';
    if (hasFlowifyApi) return 'API Flowify non joignable';
    return 'API Flowify manquante';
  }, [hasFlowifyApi, hasYoutubeKey, health, healthLoading]);

  const heading = useMemo(() => {
    if (view === 'library') return 'Titres sauvegardes';
    if (view === 'cloud') return 'Cloud';
    if (view === 'playlists') return activePlaylist?.name || 'Playlists';
    if (view === 'settings') return 'Parametres';
    if (view === 'search') return 'Recherche';
    return 'Flowify';
  }, [activePlaylist?.name, view]);

  return (
    <div className={user ? 'app-shell' : 'app-shell auth-mode'}>
      <audio
        crossOrigin="anonymous"
        ref={audioRef}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
        }}
        onEnded={() => {
          setPlaying(false);
          playOffset(1);
        }}
        onError={(event) => {
          setPlaying(false);
          const source = event.currentTarget.currentSrc;
          const code = event.currentTarget.error?.code;
          const sourceLabel = currentTrack?.source === 'cloud' ? 'Cloud' : 'yt-dlp';
          setMessage(`Lecture ${sourceLabel} impossible${code ? ` (code ${code})` : ''}.`);
          if (source) {
            probeAudioSource(source)
              .catch((error) => setMessage(errorMessage(error)));
          }
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
      />

      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}flowify-logo.png`} alt="Flowify" />
        </div>

        {user && (
          <>
            <form className="search-box" onSubmit={submitSearch}>
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher ou coller une URL"
              />
              <button aria-label="Rechercher" disabled={!query.trim() || loading} type="submit">
                {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              </button>
            </form>

            <nav className="nav-list">
              <button className={view === 'home' ? 'active' : ''} onClick={loadTrending} type="button">
                <Home size={18} />
                Tendances
              </button>
              <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')} type="button">
                <Heart size={18} />
                Bibliotheque
                <span>{savedTracks.length}</span>
              </button>
              <button className={view === 'cloud' ? 'active' : ''} onClick={() => setView('cloud')} type="button">
                <Cloud size={18} />
                Cloud
                <span>{cloudTracks.length}</span>
              </button>
              <button className={view === 'playlists' ? 'active' : ''} onClick={() => setView('playlists')} type="button">
                <ListMusic size={18} />
                Playlists
                <span>{playlists.length}</span>
              </button>
              <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')} type="button">
                <Settings size={18} />
                Parametres
              </button>
            </nav>

            <section className="sidebar-section">
              <div className="section-title">
                <ListMusic size={16} />
                Playlists
              </div>
              <form className="side-form" onSubmit={createPlaylist}>
                <input
                  value={newPlaylistName}
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                  placeholder="Nouvelle playlist"
                />
                <button aria-label="Creer" disabled={playlistBusy || !newPlaylistName.trim()} type="submit">
                  <Plus size={16} />
                </button>
              </form>
              <form className="side-form" onSubmit={joinPlaylist}>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="Code invitation"
                />
                <button aria-label="Rejoindre" disabled={playlistBusy || !joinCode.trim()} type="submit">
                  <UserPlus size={16} />
                </button>
              </form>
              <div className="playlist-stack">
                {playlists.map((playlist) => (
                  <button
                    className={activePlaylistId === playlist.id ? 'playlist-button active' : 'playlist-button'}
                    key={playlist.id}
                    onClick={() => openPlaylist(playlist)}
                    type="button"
                  >
                    <span>{playlist.name}</span>
                    <small>{playlist.tracks.length}</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <div className="status-panel">
          <div>
            <Server size={18} />
            <span>{statusLabel}</span>
          </div>
          <button onClick={refreshHealth} type="button">
            <Cloud size={16} />
          </button>
        </div>

        <div className="account-panel">
          {user ? (
            <>
              <div>
                <strong>{user.email}</strong>
                <span>{standalone ? 'PWA installe' : 'PWA web'}</span>
              </div>
              <button aria-label="Se deconnecter" onClick={signOut} type="button">
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <span>Connexion requise</span>
          )}
        </div>
      </aside>

      <main className="main">
        {!user ? (
          <section className="auth-surface">
            <div className="auth-card">
              <img src={`${import.meta.env.BASE_URL}flowify-icon.png`} alt="" />
              <h1>Flowify</h1>
              <form onSubmit={submitAuth}>
                <label>
                  Email
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
                </label>
                <label>
                  Mot de passe
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
                </label>
                <button disabled={authBusy || !email || !password} type="submit">
                  {authBusy ? <Loader2 className="spin" size={18} /> : <LogIn size={18} />}
                  {authMode === 'signin' ? 'Connexion' : 'Creer un compte'}
                </button>
              </form>
              <button className="link-button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')} type="button">
                {authMode === 'signin' ? 'Creer un compte' : 'J ai deja un compte'}
              </button>
            </div>
          </section>
        ) : (
          <>
            <header className="topbar">
              <div>
                <p>{view === 'home' ? 'Tendances France' : view}</p>
                <h1>{heading}</h1>
              </div>
              <div className="top-actions">
                {view === 'cloud' && (
                  <label className={cloudUploadBusy ? 'upload-action disabled' : 'upload-action'}>
                    {cloudUploadBusy ? <Loader2 className="spin" size={18} /> : <Cloud size={18} />}
                    Upload
                    <input accept="audio/*" disabled={cloudUploadBusy} onChange={uploadCloudFile} type="file" />
                  </label>
                )}
                {view === 'playlists' && activePlaylist && (
                  <button onClick={() => copyInviteCode(activePlaylist)} type="button">
                    <Copy size={18} />
                    {activePlaylist.inviteCode}
                  </button>
                )}
                {installPrompt && (
                  <button onClick={installApp} type="button">
                    <Download size={18} />
                    Installer
                  </button>
                )}
              </div>
            </header>

            {message && (
              <button className="message-bar" onClick={() => setMessage('')} type="button">
                <CircleAlert size={18} />
                {message}
              </button>
            )}

            {view === 'settings' ? (
              <section className="settings-grid">
                <form className="settings-card settings-form" onSubmit={saveSettings}>
                  <h2>Connexions</h2>
                  <label>
                    Cle YouTube Data API v3
                    <input
                      value={settingsYoutubeKey}
                      onChange={(event) => setSettingsYoutubeKey(event.target.value)}
                      placeholder="AIza..."
                      type="password"
                    />
                  </label>
                  <label>
                    URL API Flowify yt-dlp
                    <input
                      value={settingsFlowifyApiUrl}
                      onChange={(event) => setSettingsFlowifyApiUrl(event.target.value)}
                      placeholder="https://ton-api-flowify.onrender.com"
                      type="url"
                    />
                  </label>
                  <div className="settings-actions">
                    <button className="code-pill" type="submit">
                      <Settings size={16} />
                      Sauvegarder
                    </button>
                    {hasYoutubeKey && (
                      <button className="muted-action" onClick={removeYoutubeKey} type="button">
                        Supprimer la cle
                      </button>
                    )}
                    {hasFlowifyApi && (
                      <button className="muted-action" onClick={removeFlowifyApiUrl} type="button">
                        Supprimer l'URL API
                      </button>
                    )}
                  </div>
                  <span>{statusLabel}</span>
                </form>
                <article className="settings-card">
                  <h2>Android APK</h2>
                  <p>Le workflow GitHub genere un APK debug a chaque push.</p>
                  <span>.github/workflows/android.yml</span>
                </article>
                <article className="settings-card">
                  <h2>GitHub Pages</h2>
                  <p>Le PWA est publie automatiquement depuis apps/web/dist.</p>
                  <span>.github/workflows/pages.yml</span>
                </article>
                <article className="settings-card">
                  <h2>Playlist active</h2>
                  {activePlaylist ? (
                    <>
                      <p>{activePlaylist.name}</p>
                      <div className="settings-actions">
                        <button className="code-pill" onClick={() => copyInviteCode(activePlaylist)} type="button">
                          <Copy size={16} />
                          {activePlaylist.inviteCode}
                        </button>
                        {activePlaylist.ownerId === user.id && (
                          <>
                            <button className="muted-action" disabled={playlistBusy} onClick={() => regenerateInviteCode(activePlaylist)} type="button">
                              Generer un code
                            </button>
                            <button className="danger-action" disabled={playlistBusy} onClick={() => deletePlaylist(activePlaylist)} type="button">
                              <Trash2 size={16} />
                              Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <p>Aucune playlist active</p>
                  )}
                </article>
              </section>
            ) : (
              <>
                {view === 'playlists' && (
                  <section className="playlist-header">
                    {activePlaylist ? (
                      <>
                        <div>
                          <Users size={18} />
                          {activePlaylist.memberCount} membre{activePlaylist.memberCount > 1 ? 's' : ''}
                        </div>
                        <button className="code-pill" onClick={() => copyInviteCode(activePlaylist)} type="button">
                          <Copy size={16} />
                          {activePlaylist.inviteCode}
                        </button>
                        {activePlaylist.ownerId === user.id && (
                          <>
                            <button className="muted-action" disabled={playlistBusy} onClick={() => regenerateInviteCode(activePlaylist)} type="button">
                              Generer un code
                            </button>
                            <button className="danger-action" disabled={playlistBusy} onClick={() => deletePlaylist(activePlaylist)} type="button">
                              <Trash2 size={16} />
                              Supprimer
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <span>Cree une playlist ou rejoins-en une avec un code.</span>
                    )}
                  </section>
                )}

                <section className="track-grid">
                  {loading && !visibleTracks.length ? (
                    <div className="empty-state">
                      <Loader2 className="spin" size={28} />
                      Chargement
                    </div>
                  ) : visibleTracks.length ? (
                    visibleTracks.map((track, index) => (
                      <article className={currentTrack?.id === track.id ? 'track-card active' : 'track-card'} key={`${track.id}-${index}`}>
                        <button className="cover-button" onClick={() => playTrack(track, visibleTracks, index)} type="button">
                          {track.thumbnail ? <img src={track.thumbnail} alt="" loading="lazy" /> : <span />}
                          <i>{currentTrack?.id === track.id && playing ? <Pause size={22} /> : <Play size={22} />}</i>
                        </button>
                        <div className="track-copy">
                          <h2>{track.title}</h2>
                          <p>{track.channel}</p>
                        </div>
                        <span className="duration">{track.duration || '--:--'}</span>
                        <div className="track-actions">
                          <button className={savedIds.has(track.id) ? 'saved' : ''} aria-label="Sauvegarder" onClick={() => toggleSave(track)} type="button">
                            <Heart size={17} />
                          </button>
                          {view === 'playlists' ? (
                            <button aria-label="Retirer de la playlist" onClick={() => removeTrackFromPlaylist(track)} type="button">
                              <Trash2 size={17} />
                            </button>
                          ) : (
                            <button aria-label="Ajouter a la playlist" disabled={!playlistTarget} onClick={() => addTrackToPlaylist(track)} type="button">
                              <Plus size={17} />
                            </button>
                          )}
                          {view === 'cloud' && track.source === 'cloud' && (
                            <button aria-label="Supprimer du Cloud" disabled={cloudDeleteBusy[track.id]} onClick={() => deleteCloudTrack(track)} type="button">
                              {cloudDeleteBusy[track.id] ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}
                            </button>
                          )}
                          {track.source !== 'cloud' && (
                            <button aria-label="Telecharger via yt-dlp" disabled={downloadBusy[track.id]} onClick={() => requestDownload(track)} type="button">
                              {downloadBusy[track.id] ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                            </button>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">
                      <Search size={28} />
                      {view === 'playlists' ? 'Playlist vide' : view === 'cloud' ? 'Aucune musique Cloud' : 'Aucun titre'}
                    </div>
                  )}
                </section>

                {nextPageToken && view === 'search' && (
                  <button className="load-more" disabled={loading} onClick={loadMore} type="button">
                    {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                    Charger plus
                  </button>
                )}
              </>
            )}
          </>
        )}
      </main>

      {user && (
        <footer className="player">
          <div className="now-playing">
            {currentTrack?.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" />
            ) : (
              <div className="empty-cover" />
            )}
            <div>
              <strong>{currentTrack?.title || 'Aucun titre'}</strong>
              <span>{currentTrack?.channel || 'Flowify'}</span>
            </div>
          </div>

          <div className="player-controls">
            <button aria-label="Precedent" onClick={() => playOffset(-1)} type="button">
              <SkipBack size={20} />
            </button>
            <button className="play-toggle" aria-label="Lecture" disabled={!currentTrack} onClick={togglePlay} type="button">
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button aria-label="Suivant" onClick={() => playOffset(1)} type="button">
              <SkipForward size={20} />
            </button>
          </div>

          <div className="progress-wrap">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Progression"
              min="0"
              max={duration || 0}
              step="1"
              value={Math.min(currentTime, duration || 0)}
              disabled={!duration}
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                try {
                  if (audioRef.current) audioRef.current.currentTime = nextTime;
                } catch {
                  setMessage('Deplacement indisponible pendant le chargement yt-dlp.');
                }
                setCurrentTime(nextTime);
              }}
              type="range"
            />
            <span>{formatTime(duration)}</span>
          </div>
        </footer>
      )}
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseDisplayDuration(value: string) {
  const parts = value
    .split(':')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (!parts.length) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function titleFromFile(value: string) {
  const clean = value.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return clean || 'Musique Cloud';
}

async function probeAudioSource(source: string) {
  try {
    const response = await fetch(source, {
      cache: 'no-store',
      headers: { Range: 'bytes=0-1023' },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(readApiError(text) || `API audio Flowify HTTP ${response.status}`);
    }
    if (!contentType.toLowerCase().startsWith('audio/')) {
      const text = await response.text().catch(() => '');
      throw new Error(readApiError(text) || `Format audio invalide: ${contentType || 'inconnu'}`);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('API Flowify inaccessible depuis le navigateur. Attends le reveil Render puis actualise.');
    }
    throw error;
  }
}

function readApiError(value: string) {
  if (!value.trim()) return '';
  try {
    const payload = JSON.parse(value) as { error?: unknown; message?: unknown };
    if (typeof payload.error === 'string') return payload.error;
    if (typeof payload.message === 'string') return payload.message;
  } catch {
    // Non-JSON response body.
  }
  return value.slice(0, 220);
}

function errorMessage(error: unknown) {
  const message = readableErrorMessage(error);
  if (message.includes('playlists.invite_code')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes("Could not find the 'invite_code' column")) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes("Could not find the table 'public.saved_tracks'")) {
    return 'Base Supabase incomplete: execute supabase/schema.sql complet dans le SQL editor.';
  }
  if (message.includes("Could not find the table 'public.cloud_tracks'")) {
    return 'Base Supabase incomplete: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes("Could not find the table 'public.playlists'")) {
    return 'Base Supabase incomplete: execute supabase/schema.sql complet dans le SQL editor.';
  }
  if (message.includes('Cloud R2 non configure')) {
    return 'Cloud R2 non configure sur Render: ajoute R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY et R2_BUCKET.';
  }
  if (message.includes('R2_BUCKET invalide')) {
    return 'R2_BUCKET invalide sur Render: mets uniquement le nom du bucket Cloudflare, exemple flowify-music.';
  }
  if (message === 'Failed to fetch' || message.includes('Load failed')) {
    return 'API Flowify inaccessible depuis le navigateur. Attends le reveil Render puis actualise.';
  }
  if (message.includes('playlist_members_1.joined_at')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes('row-level security policy') && message.includes('playlist_tracks')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes('The provided YouTube account cookies are no longer valid')) {
    return 'Cookies YouTube invalides sur Render: reexporte un cookies.txt recent, remplace YTDLP_COOKIES_BASE64, puis redeploie.';
  }
  if (message.includes("Sign in to confirm you're not a bot") || message.includes('HTTP Error 429')) {
    return 'YouTube bloque Render: ajoute ou renouvelle les cookies YouTube dans YTDLP_COOKIES_BASE64.';
  }
  if (message.includes('Requested format is not available')) {
    return 'Format audio YouTube bloque par yt-dlp: verifie les cookies YouTube Render puis redeploie.';
  }
  if (message.includes('Could not find the function public.add_track_to_playlist')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes('Could not find the function public.delete_cloud_track')) {
    return 'Base Supabase pas a jour: execute le bloc SQL final pour les musiques Cloud.';
  }
  if (message.includes('no unique or exclusion constraint matching the ON CONFLICT specification')) {
    return 'Base Supabase pas a jour: execute le bloc SQL final pour corriger add_track_to_playlist.';
  }
  if (message.includes('Could not find the function public.delete_playlist')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes('Could not find the function public.join_playlist_by_code')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.toLowerCase().includes('code invitation invalide')) {
    return 'Code invitation invalide.';
  }
  if (message.toLowerCase().includes('playlist inaccessible')) {
    return "Tu n'as pas acces a cette playlist.";
  }
  return message;
}

function readableErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const fields = ['message', 'details', 'hint', 'code', 'error'];
    const record = error as Record<string, unknown>;
    for (const field of fields) {
      const value = record[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Erreur inconnue';
    }
  }
  return String(error);
}
