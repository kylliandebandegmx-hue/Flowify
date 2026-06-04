import type { Session, User } from '@supabase/supabase-js';
import {
  Check,
  CircleAlert,
  Cloud,
  Copy,
  Download,
  Heart,
  Image as ImageIcon,
  KeyRound,
  ListMusic,
  ListChecks,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  MoreHorizontal,
  Pause,
  Palette,
  Play,
  Plus,
  Repeat,
  Search,
  Server,
  Settings,
  Shield,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  X,
  Youtube,
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
  uploadCloudTrack,
} from './lib/api';
import { isStandaloneDisplay } from './lib/pwa';
import { supabase } from './lib/supabase';
import type {
  ApiHealth,
  CloudTrackRow,
  Playlist,
  PlaylistMember,
  PlaylistRole,
  PlaylistRow,
  Profile,
  SavedTrackRow,
  Track,
} from './types';

type ViewMode = 'home' | 'search' | 'cloud' | 'playlists' | 'settings';
type AuthMode = 'signin' | 'signup' | 'reset';
type TrackSelectionMode = 'cloud' | 'playlist' | null;
type PlaylistPanel = 'members' | 'customize' | null;
type PlayTrackOptions = {
  skipProbe?: boolean;
};

const THEME_PRIMARY_KEY = 'flowify.theme.primary';
const THEME_SECONDARY_KEY = 'flowify.theme.secondary';
const DEFAULT_PRIMARY_COLOR = '#4BF5FB';
const DEFAULT_SECONDARY_COLOR = '#9E43F0';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface YouTubePlayer {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  loadVideoById: (videoId: string) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  stopVideo: () => void;
}

interface YouTubePlayerEvent {
  data: number;
  target: YouTubePlayer;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      height: string;
      width: string;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YouTubePlayer }) => void;
        onStateChange?: (event: YouTubePlayerEvent) => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const queueIndexRef = useRef(-1);
  const currentTrackRef = useRef<Track | null>(null);
  const shuffleEnabledRef = useRef(false);
  const repeatEnabledRef = useRef(false);
  const autoAdvanceLockRef = useRef(false);
  const youtubeContainerRef = useRef<HTMLDivElement | null>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const youtubeProgressTimerRef = useRef<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const user = session?.user || null;

  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [savedTracks, setSavedTracks] = useState<Track[]>([]);
  const [cloudTracks, setCloudTracks] = useState<Track[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState('');
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [settingsYoutubeKey, setSettingsYoutubeKey] = useState(() => getYoutubeApiKey());
  const [settingsFlowifyApiUrl, setSettingsFlowifyApiUrl] = useState(() => getFlowifyApiBaseUrl());
  const [primaryColor, setPrimaryColor] = useState(() => readThemeColor(THEME_PRIMARY_KEY, DEFAULT_PRIMARY_COLOR));
  const [secondaryColor, setSecondaryColor] = useState(() => readThemeColor(THEME_SECONDARY_KEY, DEFAULT_SECONDARY_COLOR));
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
  const [youtubeVideoId, setYoutubeVideoId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(() => getInitialVolume());
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState<Record<string, boolean>>({});
  const [cloudDeleteBusy, setCloudDeleteBusy] = useState<Record<string, boolean>>({});
  const [cloudUploadBusy, setCloudUploadBusy] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState<TrackSelectionMode>(null);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [playlistPanel, setPlaylistPanel] = useState<PlaylistPanel>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);

  const activePlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === activePlaylistId) || null,
    [activePlaylistId, playlists],
  );
  const canEditPlaylist = useCallback((playlist: Playlist | null | undefined) => {
    if (!user || !playlist) return false;
    if (playlist.ownerId === user.id) return true;
    return playlist.members.some((member) => member.userId === user.id && member.role === 'editor');
  }, [user]);
  const activePlaylistCanManage = Boolean(user && activePlaylist?.ownerId === user.id);
  const activePlaylistCanEdit = canEditPlaylist(activePlaylist);

  const visibleTracks =
    view === 'cloud'
      ? cloudTracks
      : view === 'playlists'
        ? activePlaylist?.tracks || []
        : tracks;

  const playlistTarget = activePlaylist || playlists.find((playlist) => canEditPlaylist(playlist)) || playlists[0] || null;
  const playlistTargetCanEdit = canEditPlaylist(playlistTarget);
  const activePlaylistIsCurrent = Boolean(
    activePlaylist &&
    currentTrack &&
    activePlaylist.tracks.some((track) => track.id === currentTrack.id),
  );
  const activePlaylistPlaying = Boolean(activePlaylistIsCurrent && playing);
  const playbackProgress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const currentSelectionMode = view === 'cloud' ? 'cloud' : view === 'playlists' ? 'playlist' : null;
  const selectionActive = Boolean(currentSelectionMode && selectionMode === currentSelectionMode);
  const selectableTracks = useMemo(() => {
    if (view === 'cloud') return cloudTracks;
    if (view === 'playlists') return activePlaylist?.tracks || [];
    return [];
  }, [activePlaylist?.tracks, cloudTracks, view]);
  const selectedTracks = useMemo(
    () => selectableTracks.filter((track) => selectedTrackIds.has(track.id)),
    [selectableTracks, selectedTrackIds],
  );
  const allSelectableTracksSelected = Boolean(selectableTracks.length && selectedTracks.length === selectableTracks.length);
  const selectionDeleteBusy = playlistBusy || selectedTracks.some((track) => cloudDeleteBusy[track.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setView('settings');
        setMessage('Choisis un nouveau mot de passe dans Parametres.');
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    applyThemeColors(primaryColor, secondaryColor);
  }, [primaryColor, secondaryColor]);

  useEffect(() => {
    setSelectedTrackIds(new Set());
    setSelectionMode(null);
  }, [activePlaylistId, view]);

  useEffect(() => {
    setPlaylistNameDraft(activePlaylist?.name || '');
    setPlaylistMenuOpen(false);
    setPlaylistPanel(null);
  }, [activePlaylist?.id, activePlaylist?.name]);

  useEffect(() => {
    setSelectedTrackIds((previous) => {
      if (!previous.size) return previous;
      const visibleIds = new Set(selectableTracks.map((track) => track.id));
      const next = new Set([...previous].filter((trackId) => visibleIds.has(trackId)));
      return next.size === previous.size ? previous : next;
    });
  }, [selectableTracks]);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    setStandalone(isStandaloneDisplay());
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    youtubePlayerRef.current?.setVolume(Math.round(volume * 100));
    localStorage.setItem('flowify.volume', String(volume));
  }, [volume]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    shuffleEnabledRef.current = shuffleEnabled;
  }, [shuffleEnabled]);

  useEffect(() => {
    repeatEnabledRef.current = repeatEnabled;
  }, [repeatEnabled]);

  useEffect(() => {
    if (!user) return;
    loadYouTubeIframeApi().catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {
      undefined;
    }
  }, [playing]);

  useEffect(() => {
    if (!currentTrack || !('mediaSession' in navigator)) return;
    const artwork = currentTrack.thumbnail
      ? [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/png' }]
      : [{ src: `${window.location.origin}${import.meta.env.BASE_URL}flowify-icon-512.png`, sizes: '512x512', type: 'image/png' }];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.channel || 'Flowify',
        album: 'Flowify',
        artwork,
      });
    } catch {
      undefined;
    }
  }, [currentTrack]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!currentTrack || !Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    } catch {
      undefined;
    }
  }, [currentTime, currentTrack, duration]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const sessionApi = navigator.mediaSession;
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { void togglePlay(); },
      pause: () => { void togglePlay(); },
      previoustrack: () => playOffset(-1, { skipProbe: true }),
      nexttrack: () => playOffset(1, { skipProbe: true }),
      seekbackward: () => seekCurrentTrack(Math.max(0, currentTime - 10)),
      seekforward: () => seekCurrentTrack(Math.min(duration || currentTime + 10, currentTime + 10)),
    };

    (Object.keys(handlers) as MediaSessionAction[]).forEach((action) => {
      try {
        sessionApi.setActionHandler(action, handlers[action] || null);
      } catch {
        undefined;
      }
    });
  });

  useEffect(() => () => {
    if (youtubeProgressTimerRef.current) {
      window.clearInterval(youtubeProgressTimerRef.current);
      youtubeProgressTimerRef.current = null;
    }
    youtubePlayerRef.current?.destroy();
    youtubePlayerRef.current = null;
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
      if (!getYoutubeApiKey()) {
        setTracks([]);
        setNextPageToken('');
        setView('home');
        return;
      }
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

  const loadProfile = useCallback(async (activeUser: User) => {
    const fallbackName = displayNameFromEmail(activeUser.email) || 'Flowify';
    const fallbackProfile: Profile = {
      id: activeUser.id,
      email: activeUser.email || null,
      display_name: fallbackName,
      avatar_url: null,
    };

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, avatar_url')
      .eq('id', activeUser.id)
      .maybeSingle();

    if (error) {
      setProfile(fallbackProfile);
      setProfileDisplayName(fallbackName);
      setProfileAvatarUrl('');
      return;
    }

    if (!data) {
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .upsert(fallbackProfile)
        .select('id, email, display_name, avatar_url')
        .single();

      if (createError) {
        setProfile(fallbackProfile);
        setProfileDisplayName(fallbackName);
        setProfileAvatarUrl('');
        return;
      }

      const nextProfile = created as Profile;
      setProfile(nextProfile);
      setProfileDisplayName(nextProfile.display_name || fallbackName);
      setProfileAvatarUrl(nextProfile.avatar_url || '');
      return;
    }

    const nextProfile = data as Profile;
    setProfile(nextProfile);
    setProfileDisplayName(nextProfile.display_name || fallbackName);
    setProfileAvatarUrl(nextProfile.avatar_url || '');
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
    const playlistSelect =
      'id, owner_id, name, invite_code, cover_url, created_at, updated_at, playlist_tracks(id, playlist_id, track, added_by, position, created_at), playlist_members(playlist_id, user_id, role, joined_at)';
    const fallbackPlaylistSelect =
      'id, owner_id, name, invite_code, created_at, updated_at, playlist_tracks(id, playlist_id, track, added_by, position, created_at), playlist_members(playlist_id, user_id, role, joined_at)';
    const playlistResult = await supabase
      .from('playlists')
      .select(playlistSelect)
      .order('updated_at', { ascending: false });
    let data = playlistResult.data as unknown[] | null;
    let error = playlistResult.error;

    if (error && error.message.includes('cover_url')) {
      const fallbackResult = await supabase
        .from('playlists')
        .select(fallbackPlaylistSelect)
        .order('updated_at', { ascending: false });
      data = fallbackResult.data as unknown[] | null;
      error = fallbackResult.error;
    }

    if (error) {
      setMessage(error.message);
      return;
    }

    const rows = (data || []) as unknown as PlaylistRow[];
    const userIds = Array.from(new Set(rows.flatMap((row) => {
      const memberIds = (row.playlist_members || []).map((member) => member.user_id);
      const addedByIds = (row.playlist_tracks || []).map((trackRow) => trackRow.added_by || '');
      return [row.owner_id, ...memberIds, ...addedByIds];
    }).filter(Boolean)));
    const profilesById = new Map<string, Profile>();

    if (userIds.length) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, email, display_name, avatar_url')
        .in('id', userIds);

      ((profileRows || []) as Profile[]).forEach((memberProfile) => {
        profilesById.set(memberProfile.id, memberProfile);
      });
    }

    const mapped = rows.map((row) => {
      const rawMembers = row.playlist_members || [];
      const members = [
        ...(rawMembers.some((member) => member.user_id === row.owner_id)
          ? []
          : [{ playlist_id: row.id, user_id: row.owner_id, role: 'owner' as const, joined_at: row.created_at }]),
        ...rawMembers,
      ].map((member) => {
        const memberProfile = profilesById.get(member.user_id);
        const memberRole = normalizePlaylistRole(member.role);
        const displayName =
          memberProfile?.display_name ||
          displayNameFromEmail(memberProfile?.email) ||
          (memberRole === 'owner' ? 'Createur' : 'Membre');

        return {
          userId: member.user_id,
          role: memberRole,
          displayName,
          avatarUrl: memberProfile?.avatar_url || '',
          joinedAt: member.joined_at,
        };
      });
      const membersById = new Map(members.map((member) => [member.userId, member]));

      return {
        id: row.id,
        ownerId: row.owner_id,
        name: row.name,
        inviteCode: row.invite_code,
        coverUrl: row.cover_url || '',
        members,
        memberCount: members.length || 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tracks: [...(row.playlist_tracks || [])]
          .sort((a, b) => {
            const byPosition = (a.position || 0) - (b.position || 0);
            if (byPosition !== 0) return byPosition;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          })
          .map((trackRow) => {
            const addedBy =
              (trackRow.added_by && membersById.get(trackRow.added_by)) ||
              (trackRow.added_by
                ? profileToPlaylistMember(trackRow.added_by, profilesById.get(trackRow.added_by))
                : undefined);
            return {
              ...trackRow.track,
              addedById: trackRow.added_by,
              addedBy,
            };
          })
          .filter(Boolean),
      };
    });

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
    loadProfile(user);
    loadSavedTracks(user);
    loadCloudTracks(user);
    loadPlaylists(user);
    loadTrending();
  }, [loadCloudTracks, loadProfile, loadSavedTracks, loadPlaylists, loadTrending, user]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, reloadPlaylists)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPlaylists, user]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) return;

    setAuthBusy(true);
    setMessage('');
    try {
      if (authMode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: getAuthRedirectUrl(),
        });
        if (error) throw error;
        setMessage('Email de reinitialisation envoye.');
        return;
      }

      if (!password) return;

      const result = authMode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        : await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { display_name: displayNameFromEmail(cleanEmail) },
            emailRedirectTo: getAuthRedirectUrl(),
          },
        });

      if (result.error) throw result.error;
      if (authMode === 'signup' && result.data.user) {
        if (result.data.session) {
          await supabase.from('profiles').upsert({
            id: result.data.user.id,
            email: cleanEmail,
            display_name: displayNameFromEmail(cleanEmail),
          });
        }
        setMessage(result.data.session
          ? 'Compte cree.'
          : 'Compte cree. Verifie tes emails si Supabase demande une confirmation.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setMessage('Le nouveau mot de passe doit faire au moins 6 caracteres.');
      return;
    }

    setPasswordBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setPasswordRecovery(false);
      setMessage('Mot de passe mis a jour.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSavedTracks([]);
    setCloudTracks([]);
    setSavedIds(new Set());
    setPlaylists([]);
    setProfile(null);
    setProfileDisplayName('');
    setProfileAvatarUrl('');
    setPasswordRecovery(false);
    setNewPassword('');
    setTracks([]);
    queueRef.current = [];
    queueIndexRef.current = -1;
    stopYouTubePlayer();
    setCurrentTrack(null);
    setPlaying(false);
    setSidebarOpen(false);
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
      setSidebarOpen(false);
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
        setSidebarOpen(false);
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
        setSidebarOpen(false);
        setMessage('Playlist rejointe.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const uploadCloudFiles = async (files: File[], targetPlaylist?: Playlist | null) => {
    if (!user || !files.length) return;
    const audioFiles = files.filter((file) => file.type.startsWith('audio/'));
    if (!audioFiles.length) {
      setMessage('Choisis un fichier audio.');
      return;
    }

    setCloudUploadBusy(true);
    setMessage(targetPlaylist
      ? (audioFiles.length > 1 ? `Upload playlist: 0/${audioFiles.length}` : 'Upload dans la playlist...')
      : (audioFiles.length > 1 ? `Upload Cloud: 0/${audioFiles.length}` : 'Upload Cloud en cours...'));
    let uploadedCount = 0;
    try {
      for (const file of audioFiles) {
        const embeddedCover = await extractEmbeddedCover(file);
        const uploaded = await uploadCloudTrack(file);
        const track: Track = {
          id: `cloud:${uploaded.key}`,
          title: titleFromFile(uploaded.fileName || file.name),
          channel: 'Cloud Flowify',
          thumbnail: embeddedCover,
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

        if (targetPlaylist) {
          const position = (targetPlaylist.tracks.length + uploadedCount + 1) * 1000;
          const { error: playlistError } = await supabase.rpc('add_track_to_playlist', {
            target_playlist_id: targetPlaylist.id,
            target_youtube_id: track.id,
            target_position: position,
            track_payload: track,
          });
          if (playlistError) throw playlistError;
        }

        uploadedCount += 1;
        if (audioFiles.length > 1) {
          setMessage(targetPlaylist
            ? `Upload playlist: ${uploadedCount}/${audioFiles.length}`
            : `Upload Cloud: ${uploadedCount}/${audioFiles.length}`);
        }
      }

      await loadCloudTracks(user);
      if (targetPlaylist) {
        setActivePlaylistId(targetPlaylist.id);
        setView('playlists');
      } else {
        setView('cloud');
      }
      await loadPlaylists(user);
      setMessage(targetPlaylist
        ? (uploadedCount > 1 ? `${uploadedCount} musiques ajoutees dans ${targetPlaylist.name}.` : `Musique ajoutee dans ${targetPlaylist.name}.`)
        : (uploadedCount > 1 ? `${uploadedCount} musiques ajoutees au Cloud.` : 'Musique ajoutee au Cloud.'));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setCloudUploadBusy(false);
    }
  };

  const uploadCloudFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await uploadCloudFiles(files);
  };

  const uploadCloudFileToPlaylist = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!activePlaylistCanEdit) {
      setMessage('Permission editeur requise pour ajouter des musiques.');
      return;
    }
    await uploadCloudFiles(files, activePlaylist);
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

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const displayName = profileDisplayName.trim() || displayNameFromEmail(user.email) || 'Flowify';
    const avatarUrl = profileAvatarUrl.trim();
    setProfileBusy(true);
    setMessage('');

    try {
      const payload = {
        id: user.id,
        email: user.email || null,
        display_name: displayName,
        avatar_url: avatarUrl || null,
      };
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload)
        .select('id, email, display_name, avatar_url')
        .single();

      if (error) throw error;

      const nextProfile = data as Profile;
      setProfile(nextProfile);
      setProfileDisplayName(nextProfile.display_name || displayName);
      setProfileAvatarUrl(nextProfile.avatar_url || '');
      await loadPlaylists(user);
      setMessage('Profil sauvegarde.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setProfileBusy(false);
    }
  };

  const saveAppearance = (event: FormEvent) => {
    event.preventDefault();
    const nextPrimary = isThemeColor(primaryColor) ? primaryColor : DEFAULT_PRIMARY_COLOR;
    const nextSecondary = isThemeColor(secondaryColor) ? secondaryColor : DEFAULT_SECONDARY_COLOR;

    localStorage.setItem(THEME_PRIMARY_KEY, nextPrimary);
    localStorage.setItem(THEME_SECONDARY_KEY, nextSecondary);
    setPrimaryColor(nextPrimary);
    setSecondaryColor(nextSecondary);
    applyThemeColors(nextPrimary, nextSecondary);
    setMessage('Couleurs sauvegardees.');
  };

  const resetAppearance = () => {
    localStorage.removeItem(THEME_PRIMARY_KEY);
    localStorage.removeItem(THEME_SECONDARY_KEY);
    setPrimaryColor(DEFAULT_PRIMARY_COLOR);
    setSecondaryColor(DEFAULT_SECONDARY_COLOR);
    applyThemeColors(DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR);
    setMessage('Couleurs reinitialisees.');
  };

  const selectProfilePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('Choisis une image pour la photo de profil.');
      return;
    }
    if (file.size > 750_000) {
      setMessage('Image trop lourde. Choisis moins de 750 Ko.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileAvatarUrl(reader.result);
      }
    };
    reader.onerror = () => setMessage('Impossible de charger cette image.');
    reader.readAsDataURL(file);
  };

  const selectPlaylistCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!user || !activePlaylist || activePlaylist.ownerId !== user.id || !file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('Choisis une image pour la playlist.');
      return;
    }
    if (file.size > 900_000) {
      setMessage('Image trop lourde. Choisis moins de 900 Ko.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') return;
      setPlaylistBusy(true);
      setMessage('');
      try {
        const { error } = await supabase
          .from('playlists')
          .update({ cover_url: reader.result })
          .eq('id', activePlaylist.id)
          .eq('owner_id', user.id);
        if (error) throw error;
        await loadPlaylists(user);
        setMessage('Photo de playlist sauvegardee.');
      } catch (error) {
        setMessage(errorMessage(error));
      } finally {
        setPlaylistBusy(false);
      }
    };
    reader.onerror = () => setMessage('Impossible de charger cette image.');
    reader.readAsDataURL(file);
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

  const renamePlaylist = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !activePlaylist || activePlaylist.ownerId !== user.id) return;
    const cleanName = playlistNameDraft.trim();
    if (!cleanName) {
      setMessage('Nom de playlist manquant.');
      return;
    }
    if (cleanName === activePlaylist.name) {
      return;
    }

    setPlaylistBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_playlist_name', {
        target_playlist_id: activePlaylist.id,
        next_name: cleanName,
      });
      if (error) throw error;
      await loadPlaylists(user);
      setMessage('Playlist renommee.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const updatePlaylistMemberRole = async (member: PlaylistMember, role: PlaylistRole) => {
    if (!user || !activePlaylist || activePlaylist.ownerId !== user.id || member.role === 'owner') return;

    setPlaylistBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_playlist_member_role', {
        target_playlist_id: activePlaylist.id,
        target_user_id: member.userId,
        next_role: role,
      });
      if (error) throw error;
      await loadPlaylists(user);
      setMessage('Permission mise a jour.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const removePlaylistMember = async (member: PlaylistMember) => {
    if (!user || !activePlaylist || member.role === 'owner') return;
    if (activePlaylist.ownerId !== user.id && member.userId !== user.id) return;
    const confirmed = window.confirm(`Retirer ${member.displayName} de "${activePlaylist.name}" ?`);
    if (!confirmed) return;

    setPlaylistBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('remove_playlist_member', {
        target_playlist_id: activePlaylist.id,
        target_user_id: member.userId,
      });
      if (error) throw error;
      if (member.userId === user.id) setActivePlaylistId('');
      await loadPlaylists(user);
      setMessage('Membre retire.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const toggleTrackSelection = (track: Track) => {
    setSelectedTrackIds((previous) => {
      const next = new Set(previous);
      if (next.has(track.id)) next.delete(track.id);
      else next.add(track.id);
      return next;
    });
  };

  const toggleSelectAllTracks = () => {
    setSelectedTrackIds(() => {
      if (allSelectableTracksSelected) return new Set();
      return new Set(selectableTracks.map((track) => track.id));
    });
  };

  const clearTrackSelection = () => {
    setSelectedTrackIds(new Set());
    setSelectionMode(null);
  };

  const startTrackSelection = (mode: Exclude<TrackSelectionMode, null>) => {
    setSelectedTrackIds(new Set());
    setSelectionMode(mode);
  };

  const stopCurrentPlayback = () => {
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute('src');
    stopYouTubePlayer();
    setCurrentTrack(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  const addTrackToPlaylist = async (track: Track, playlist = playlistTarget) => {
    if (!user || !playlist) {
      setMessage('Cree ou rejoins une playlist avant d ajouter un titre.');
      return;
    }
    if (!canEditPlaylist(playlist)) {
      setMessage('Permission editeur requise pour ajouter des titres.');
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
    if (!activePlaylistCanEdit) {
      setMessage('Permission editeur requise pour retirer des titres.');
      return;
    }

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

  const deleteCloudTracks = async (tracksToDelete: Track[], successMessage: string) => {
    if (!user) return;
    const cloudTracksToDelete = tracksToDelete.filter((track) => track.source === 'cloud' && track.storageKey);
    if (!cloudTracksToDelete.length) return;

    const deletedIds = new Set(cloudTracksToDelete.map((track) => track.id));
    setCloudDeleteBusy((previous) => {
      const next = { ...previous };
      cloudTracksToDelete.forEach((track) => {
        next[track.id] = true;
      });
      return next;
    });
    setMessage('');

    let storageDeleteFailed = false;
    try {
      for (const track of cloudTracksToDelete) {
        const { error } = await supabase.rpc('delete_cloud_track', {
          target_storage_key: track.storageKey as string,
        });
        if (error) throw error;

        try {
          await deleteCloudTrackObject(track.storageKey as string);
        } catch {
          storageDeleteFailed = true;
        }
      }

      setCloudTracks((previous) => previous.filter((item) => !deletedIds.has(item.id)));
      setSavedTracks((previous) => previous.filter((item) => !deletedIds.has(item.id)));
      setSavedIds((previous) => {
        const copy = new Set(previous);
        deletedIds.forEach((trackId) => copy.delete(trackId));
        return copy;
      });
      setSelectedTrackIds((previous) => {
        const next = new Set(previous);
        deletedIds.forEach((trackId) => next.delete(trackId));
        return next;
      });
      if (currentTrack && deletedIds.has(currentTrack.id)) {
        stopCurrentPlayback();
      }
      await loadCloudTracks(user);
      await loadSavedTracks(user);
      await loadPlaylists(user);
      setMessage(storageDeleteFailed
        ? 'Musique supprimee de Flowify. Un fichier R2 peut rester dans le bucket.'
        : successMessage);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setCloudDeleteBusy((previous) => {
        const next = { ...previous };
        cloudTracksToDelete.forEach((track) => {
          next[track.id] = false;
        });
        return next;
      });
    }
  };

  const deleteCloudTrack = async (track: Track) => {
    if (!user || track.source !== 'cloud' || !track.storageKey) return;
    const confirmed = window.confirm(`Supprimer "${track.title}" du Cloud ?`);
    if (!confirmed) return;

    await deleteCloudTracks([track], 'Musique Cloud supprimee.');
  };

  const deleteSelectedTracks = async () => {
    if (!user || !selectedTracks.length) return;

    if (view === 'cloud') {
      const confirmed = window.confirm(`Supprimer ${selectedTracks.length} musique${selectedTracks.length > 1 ? 's' : ''} du Cloud ?`);
      if (!confirmed) return;
      await deleteCloudTracks(
        selectedTracks,
        `${selectedTracks.length} musique${selectedTracks.length > 1 ? 's' : ''} Cloud supprimee${selectedTracks.length > 1 ? 's' : ''}.`,
      );
      setSelectionMode(null);
      return;
    }

    if (view === 'playlists' && activePlaylist) {
      if (!activePlaylistCanEdit) {
        setMessage('Permission editeur requise pour retirer des titres.');
        return;
      }
      const confirmed = window.confirm(`Retirer ${selectedTracks.length} titre${selectedTracks.length > 1 ? 's' : ''} de "${activePlaylist.name}" ?`);
      if (!confirmed) return;

      setPlaylistBusy(true);
      setMessage('');
      const removedIds = new Set(selectedTracks.map((track) => track.id));
      try {
        for (const track of selectedTracks) {
          const { error } = await supabase.rpc('remove_track_from_playlist', {
            target_playlist_id: activePlaylist.id,
            target_youtube_id: track.id,
          });
          if (error) throw error;
        }

        if (currentTrack && removedIds.has(currentTrack.id)) {
          stopCurrentPlayback();
        }
        setSelectedTrackIds(new Set());
        setSelectionMode(null);
        await loadPlaylists(user);
        setMessage(`${selectedTracks.length} titre${selectedTracks.length > 1 ? 's' : ''} retire${selectedTracks.length > 1 ? 's' : ''} de la playlist.`);
      } catch (error) {
        setMessage(errorMessage(error));
      } finally {
        setPlaylistBusy(false);
      }
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
    setSidebarOpen(false);
  };

  const openView = (nextView: ViewMode) => {
    setView(nextView);
    setSidebarOpen(false);
  };

  const openTrending = () => {
    setSidebarOpen(false);
    void loadTrending();
  };

  const stopYouTubeProgress = () => {
    if (!youtubeProgressTimerRef.current) return;
    window.clearInterval(youtubeProgressTimerRef.current);
    youtubeProgressTimerRef.current = null;
  };

  const startYouTubeProgress = () => {
    stopYouTubeProgress();
    youtubeProgressTimerRef.current = window.setInterval(() => {
      const player = youtubePlayerRef.current;
      if (!player) return;
      const nextTime = player.getCurrentTime();
      const nextDuration = player.getDuration();
      if (Number.isFinite(nextTime)) setCurrentTime(nextTime);
      if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
    }, 500);
  };

  const ensureYouTubePlayer = async () => {
    if (youtubePlayerRef.current) return youtubePlayerRef.current;
    const api = await loadYouTubeIframeApi();
    const container = youtubeContainerRef.current;
    if (!container) throw new Error('Lecteur YouTube indisponible.');

    container.innerHTML = '';
    const target = document.createElement('div');
    container.appendChild(target);

    const player = await new Promise<YouTubePlayer>((resolve) => {
      const nextPlayer = new api.Player(target, {
        height: '90',
        width: '160',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            event.target.setVolume(Math.round(volume * 100));
            resolve(event.target);
          },
          onStateChange: (event) => {
            if (event.data === api.PlayerState.PLAYING || event.data === api.PlayerState.BUFFERING) {
              setPlaying(true);
              startYouTubeProgress();
            }
            if (event.data === api.PlayerState.PAUSED) {
              setPlaying(false);
              stopYouTubeProgress();
            }
            if (event.data === api.PlayerState.ENDED) {
              stopYouTubeProgress();
              advanceFromPlaybackEnd();
            }
          },
        },
      });
      youtubePlayerRef.current = nextPlayer;
    });

    return player;
  };

  const stopYouTubePlayer = () => {
    stopYouTubeProgress();
    youtubePlayerRef.current?.stopVideo();
    setYoutubeVideoId('');
  };

  const playTrack = async (track: Track, list = visibleTracks, index = 0, options: PlayTrackOptions = {}) => {
    const audio = audioRef.current;
    autoAdvanceLockRef.current = false;

    setCurrentTrack(track);
    setQueue(list);
    setQueueIndex(index);
    queueRef.current = list;
    queueIndexRef.current = index;
    setMessage('');
    setCurrentTime(0);
    setDuration(parseDisplayDuration(track.duration));

    const isCloudTrack = track.source === 'cloud';
    if (!isCloudTrack) {
      audio?.pause();
      audio?.removeAttribute('src');
      setYoutubeVideoId(track.id);
      try {
        const player = await ensureYouTubePlayer();
        player.setVolume(Math.round(volume * 100));
        player.loadVideoById(track.id);
        player.playVideo();
        startYouTubeProgress();
      } catch (error) {
        setPlaying(false);
        setMessage(errorMessage(error));
      }
      return;
    }

    if (!audio) return;
    stopYouTubePlayer();
    const source = cloudStreamUrl(track);
    if (!source) {
      setPlaying(false);
      setMessage('Fichier Cloud introuvable.');
      return;
    }
    if (!options.skipProbe) {
      setMessage('Preparation audio Cloud...');
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
    }

    audio.pause();
    audio.removeAttribute('src');
    audio.preload = 'auto';
    audio.volume = volume;
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

  const seekCurrentTrack = (nextTime: number) => {
    try {
      if (currentTrack?.source !== 'cloud') {
        youtubePlayerRef.current?.seekTo(nextTime, true);
      } else if (audioRef.current) {
        audioRef.current.currentTime = nextTime;
      }
    } catch {
      setMessage('Deplacement indisponible pendant le chargement.');
    }
    setCurrentTime(nextTime);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!currentTrack) return;
    if (currentTrack.source !== 'cloud') {
      const player = youtubePlayerRef.current;
      if (!player) return;
      if (playing) {
        player.pauseVideo();
        setPlaying(false);
        stopYouTubeProgress();
      } else {
        player.playVideo();
        setPlaying(true);
        startYouTubeProgress();
      }
      return;
    }
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const playOffset = (offset: number, options: PlayTrackOptions = {}) => {
    const activeQueue = queueRef.current.length ? queueRef.current : queue;
    const activeIndex = queueRef.current.length ? queueIndexRef.current : queueIndex;
    if (!activeQueue.length) return;
    let nextIndex = activeIndex + offset;
    if (shuffleEnabledRef.current && offset > 0 && activeQueue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * activeQueue.length);
      } while (nextIndex === activeIndex);
    }
    const shouldRepeat = repeatEnabledRef.current;
    if (nextIndex < 0) nextIndex = shouldRepeat ? activeQueue.length - 1 : -1;
    if (nextIndex >= activeQueue.length) nextIndex = shouldRepeat ? 0 : activeQueue.length;
    if (nextIndex < 0 || nextIndex >= activeQueue.length) return;
    playTrack(activeQueue[nextIndex], activeQueue, nextIndex, options);
  };

  const advanceFromPlaybackEnd = () => {
    if (autoAdvanceLockRef.current) return;
    autoAdvanceLockRef.current = true;
    window.setTimeout(() => {
      autoAdvanceLockRef.current = false;
    }, 1800);

    setPlaying(false);
    if (repeatEnabledRef.current && currentTrackRef.current) {
      void playTrack(currentTrackRef.current, queueRef.current, queueIndexRef.current, { skipProbe: true });
    } else {
      playOffset(1, { skipProbe: true });
    }
  };

  const hasNextPlaybackTarget = () => {
    if (repeatEnabledRef.current && currentTrackRef.current) return true;
    const activeQueue = queueRef.current.length ? queueRef.current : queue;
    const activeIndex = queueRef.current.length ? queueIndexRef.current : queueIndex;
    if (!activeQueue.length) return false;
    if (shuffleEnabledRef.current && activeQueue.length > 1) return true;
    return activeIndex + 1 < activeQueue.length;
  };

  const syncCloudPlaybackTime = (audio: HTMLAudioElement) => {
    const nextTime = audio.currentTime || 0;
    setCurrentTime(nextTime);
    const nextDuration = audio.duration;
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration);
      if (!audio.paused && nextDuration - nextTime <= 0.35 && hasNextPlaybackTarget()) {
        advanceFromPlaybackEnd();
      }
    }
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

  useEffect(() => {
    if (!playing || currentTrack?.source !== 'cloud') return undefined;
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.ended) {
        advanceFromPlaybackEnd();
        return;
      }
      if (!audio.paused) {
        syncCloudPlaybackTime(audio);
      }
    }, 700);

    return () => window.clearInterval(timer);
  }, [currentTrack?.id, currentTrack?.source, playing]);

  const statusLabel = useMemo(() => {
    if (healthLoading) return 'Verification';
    if (health?.apiReachable && health.cloudStorageAvailable && hasYoutubeKey) return 'Cloud + YouTube prets';
    if (health?.apiReachable && health.cloudStorageAvailable) return 'Cloud pret';
    if (hasYoutubeKey) return 'YouTube pret';
    if (hasFlowifyApi && health?.apiReachable) return 'Flowify connecte';
    if (hasFlowifyApi) return 'Flowify hors ligne';
    return 'Flowify';
  }, [hasFlowifyApi, hasYoutubeKey, health, healthLoading]);

  const heading = useMemo(() => {
    if (view === 'cloud') return 'Cloud';
    if (view === 'playlists') return activePlaylist?.name || 'Playlists';
    if (view === 'settings') return 'Parametres';
    if (view === 'search') return 'Recherche';
    return 'YouTube';
  }, [activePlaylist?.name, view]);

  return (
    <div className={user ? 'app-shell' : 'app-shell auth-mode'}>
      <audio
        crossOrigin="anonymous"
        ref={audioRef}
        preload="auto"
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
        }}
        onEnded={() => {
          advanceFromPlaybackEnd();
        }}
        onError={(event) => {
          setPlaying(false);
          const source = event.currentTarget.currentSrc;
          const code = event.currentTarget.error?.code;
          const sourceLabel = currentTrack?.source === 'cloud' ? 'Cloud' : 'YouTube';
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
        onTimeUpdate={(event) => syncCloudPlaybackTime(event.currentTarget)}
      />

      {user && (
        <>
          <button className="sidebar-toggle" aria-label="Ouvrir le menu" onClick={() => setSidebarOpen(true)} type="button">
            <Menu size={22} />
          </button>
          {sidebarOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} type="button" />}
        </>
      )}

      <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-head">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}flowify-logo.png`} alt="Flowify" />
          </div>
          {user && (
            <button className="sidebar-close" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} type="button">
              <X size={18} />
            </button>
          )}
        </div>

        {user && (
          <>
            <div className="account-panel sidebar-account">
              <div className="account-profile">
                <ProfileAvatar
                  avatarUrl={profile?.avatar_url}
                  className="account-avatar"
                  label={profile?.display_name || user.email || 'Flowify'}
                />
                <div>
                  <strong>{profile?.display_name || displayNameFromEmail(user.email) || 'Flowify'}</strong>
                </div>
              </div>
            </div>

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
              <button className={view === 'home' ? 'active' : ''} onClick={openTrending} type="button">
                <Youtube size={18} />
                YouTube
              </button>
              <button className={view === 'cloud' ? 'active' : ''} onClick={() => openView('cloud')} type="button">
                <Cloud size={18} />
                Cloud
                <span>{cloudTracks.length}</span>
              </button>
              <button className={view === 'playlists' ? 'active' : ''} onClick={() => openView('playlists')} type="button">
                <ListMusic size={18} />
                Playlists
                <span>{playlists.length}</span>
              </button>
            </nav>

            <section className="sidebar-section">
              <div className="section-title">
                <ListMusic size={16} />
                Playlists
              </div>
              <div className="side-form-group">
                <span>Nouvelle playlist</span>
                <form className="side-form" onSubmit={createPlaylist}>
                  <input
                    value={newPlaylistName}
                    onChange={(event) => setNewPlaylistName(event.target.value)}
                    placeholder="Nom"
                  />
                  <button aria-label="Creer" disabled={playlistBusy || !newPlaylistName.trim()} type="submit">
                    <Plus size={16} />
                  </button>
                </form>
              </div>
              <div className="side-form-group">
                <span>Code d'invitation</span>
                <form className="side-form" onSubmit={joinPlaylist}>
                  <input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="Ex: A1B2C3"
                  />
                  <button aria-label="Rejoindre" disabled={playlistBusy || !joinCode.trim()} type="submit">
                    <UserPlus size={16} />
                  </button>
                </form>
              </div>
            </section>

            <section className="sidebar-section playlist-list-section">
              <div className="section-title">
                <ListMusic size={16} />
                Mes playlists
              </div>
              <div className="playlist-stack">
                {playlists.map((playlist) => (
                  <button
                    className={activePlaylistId === playlist.id ? 'playlist-button active' : 'playlist-button'}
                    key={playlist.id}
                    onClick={() => openPlaylist(playlist)}
                    type="button"
                  >
                    <PlaylistSidebarCover playlist={playlist} />
                    <span>{playlist.name}</span>
                    <small>{playlist.tracks.length}</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <div className="sidebar-bottom">
          {user ? (
            <>
              <button className={view === 'settings' ? 'settings-bottom-button active' : 'settings-bottom-button'} onClick={() => openView('settings')} type="button">
                <Settings size={18} />
                Parametres
              </button>
            </>
          ) : (
            <div className="account-panel">
              <span>Connexion requise</span>
            </div>
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
                {authMode !== 'reset' && (
                  <label>
                    Mot de passe
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                    />
                  </label>
                )}
                <button disabled={authBusy || !email.trim() || (authMode !== 'reset' && !password)} type="submit">
                  {authBusy ? <Loader2 className="spin" size={18} /> : authMode === 'reset' ? <KeyRound size={18} /> : <LogIn size={18} />}
                  {authMode === 'signin' ? 'Connexion' : authMode === 'signup' ? 'Creer un compte' : 'Envoyer le lien'}
                </button>
              </form>
              <div className="auth-links">
                <button className="link-button" onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')} type="button">
                  {authMode === 'signup' ? 'J ai deja un compte' : 'Creer un compte'}
                </button>
                <button className="link-button" onClick={() => setAuthMode(authMode === 'reset' ? 'signin' : 'reset')} type="button">
                  {authMode === 'reset' ? 'Retour connexion' : 'Mot de passe oublie'}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <header className={view === 'playlists' ? 'topbar playlist-topbar' : 'topbar'}>
              <div>
                <p>{view === 'home' ? 'YouTube' : view}</p>
                <h1>{heading}</h1>
              </div>
              <div className="top-actions">
                {view === 'cloud' && (
                  <>
                    <label className={cloudUploadBusy ? 'upload-action disabled' : 'upload-action'}>
                      {cloudUploadBusy ? <Loader2 className="spin" size={18} /> : <Cloud size={18} />}
                      Upload
                      <input accept="audio/*" disabled={cloudUploadBusy} multiple onChange={uploadCloudFile} type="file" />
                    </label>
                    {cloudTracks.length > 0 && (
                      <button className="danger-action top-danger-action" onClick={() => startTrackSelection('cloud')} type="button">
                        <ListChecks size={18} />
                        Supprimer
                      </button>
                    )}
                  </>
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
                <form className="settings-card settings-form" onSubmit={saveProfile}>
                  <h2>Profil</h2>
                  <div className="profile-editor">
                    <ProfileAvatar
                      avatarUrl={profileAvatarUrl}
                      className="profile-preview"
                      label={profileDisplayName || user.email || 'Flowify'}
                    />
                    <div>
                      <label>
                        Pseudo
                        <input
                          value={profileDisplayName}
                          onChange={(event) => setProfileDisplayName(event.target.value)}
                          placeholder="Ton pseudo"
                        />
                      </label>
                      <label>
                        Photo de profil
                        <input
                          value={profileAvatarUrl}
                          onChange={(event) => setProfileAvatarUrl(event.target.value)}
                          placeholder="URL image ou image locale"
                        />
                      </label>
                      <label className="profile-photo-picker">
                        <ImageIcon size={16} />
                        Choisir une image
                        <input accept="image/*" onChange={selectProfilePhoto} type="file" />
                      </label>
                    </div>
                  </div>
                  <div className="settings-actions">
                    <button className="code-pill" disabled={profileBusy} type="submit">
                      {profileBusy ? <Loader2 className="spin" size={16} /> : <Settings size={16} />}
                      Sauvegarder
                    </button>
                  </div>
                  <span>Visible par les membres de tes playlists.</span>
                </form>
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
                <form className="settings-card settings-form" onSubmit={saveAppearance}>
                  <h2>Couleurs</h2>
                  <div className="color-settings">
                    <label>
                      Couleur principale
                      <span className="color-row">
                        <input
                          aria-label="Couleur principale"
                          onChange={(event) => setPrimaryColor(event.target.value)}
                          type="color"
                          value={primaryColor}
                        />
                        <strong>{primaryColor.toUpperCase()}</strong>
                      </span>
                    </label>
                    <label>
                      Couleur secondaire
                      <span className="color-row">
                        <input
                          aria-label="Couleur secondaire"
                          onChange={(event) => setSecondaryColor(event.target.value)}
                          type="color"
                          value={secondaryColor}
                        />
                        <strong>{secondaryColor.toUpperCase()}</strong>
                      </span>
                    </label>
                  </div>
                  <div className="settings-actions">
                    <button className="code-pill" type="submit">
                      <Settings size={16} />
                      Sauvegarder
                    </button>
                    <button className="muted-action" onClick={resetAppearance} type="button">
                      Reinitialiser
                    </button>
                  </div>
                  <span>Ces couleurs restent sur cet appareil et changent aussi la sidebar.</span>
                </form>
                <article className="settings-card">
                  <h2>Etat des services</h2>
                  <div className="status-panel settings-status-panel">
                    <div>
                      <Server size={18} />
                      <span>{statusLabel}</span>
                    </div>
                    <button onClick={refreshHealth} type="button">
                      <Cloud size={16} />
                    </button>
                  </div>
                  <span>
                    YouTube: {hasYoutubeKey ? 'pret' : 'sans cle'} - Cloud: {health?.cloudStorageAvailable ? 'pret' : 'a verifier'}
                  </span>
                </article>
                <article className="settings-card">
                  <h2>Session</h2>
                  <p>{profile?.display_name || displayNameFromEmail(user.email) || 'Compte Flowify'}</p>
                  <button className="logout-button settings-logout-button" onClick={signOut} type="button">
                    <LogOut size={18} />
                    Deconnexion
                  </button>
                </article>
                <form className={passwordRecovery ? 'settings-card password-card attention' : 'settings-card password-card'} onSubmit={updatePassword}>
                  <h2>Mot de passe</h2>
                  <label>
                    Nouveau mot de passe
                    <input
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="6 caracteres minimum"
                      type="password"
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="code-pill" disabled={passwordBusy || newPassword.length < 6} type="submit">
                    {passwordBusy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                    Mettre a jour
                  </button>
                  {passwordRecovery && <span>Lien de reinitialisation detecte.</span>}
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
                {view === 'playlists' ? (
                  <section className="playlist-page">
                    {activePlaylist ? (
                      <>
                        <div className="playlist-hero">
                          {playlistHeroImage(activePlaylist) && (
                            <img className="playlist-hero-bg" src={playlistHeroImage(activePlaylist)} alt="" />
                          )}
                          <PlaylistCover playlist={activePlaylist} />
                          <div className="playlist-hero-copy">
                            <span className="playlist-type">
                              <ListMusic size={15} />
                              Playlist Flowify
                            </span>
                            <h2>{activePlaylist.name}</h2>
                            <p>
                              {activePlaylist.tracks.length} titre{activePlaylist.tracks.length > 1 ? 's' : ''} - {activePlaylist.memberCount} membre{activePlaylist.memberCount > 1 ? 's' : ''}
                            </p>
                            <div className="member-strip" aria-label="Membres de la playlist">
                              {activePlaylist.members.slice(0, 6).map((member) => (
                                <ProfileAvatar
                                  avatarUrl={member.avatarUrl}
                                  className="member-avatar"
                                  key={member.userId}
                                  label={member.displayName}
                                />
                              ))}
                              {activePlaylist.memberCount > 6 && (
                                <span className="member-extra">+{activePlaylist.memberCount - 6}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="playlist-command-bar">
                          <div className="playlist-primary-actions">
                            <button
                              className={activePlaylistPlaying ? 'playlist-play active' : 'playlist-play'}
                              disabled={!activePlaylist.tracks.length}
                              onClick={() => {
                                if (activePlaylistIsCurrent) {
                                  void togglePlay();
                                } else {
                                  const startIndex = getPlaylistStartIndex(activePlaylist.tracks.length, shuffleEnabled);
                                  void playTrack(activePlaylist.tracks[startIndex], activePlaylist.tracks, startIndex);
                                }
                              }}
                              type="button"
                            >
                              {activePlaylistPlaying ? <Pause size={24} /> : <Play size={24} />}
                            </button>
                            {playlistHeroImage(activePlaylist) && (
                              <button className="playlist-mini-cover" onClick={() => {
                                const startIndex = getPlaylistStartIndex(activePlaylist.tracks.length, shuffleEnabled);
                                if (activePlaylist.tracks[startIndex]) void playTrack(activePlaylist.tracks[startIndex], activePlaylist.tracks, startIndex);
                              }} type="button">
                                <img src={playlistHeroImage(activePlaylist)} alt="" loading="lazy" />
                              </button>
                            )}
                            <button
                              aria-label="Aleatoire playlist"
                              className={shuffleEnabled ? 'playlist-icon-action active' : 'playlist-icon-action'}
                              onClick={() => setShuffleEnabled((enabled) => !enabled)}
                              type="button"
                            >
                              <Shuffle size={22} />
                            </button>
                            {activePlaylistCanEdit && (
                              <label className={cloudUploadBusy ? 'upload-action disabled' : 'upload-action'}>
                                {cloudUploadBusy ? <Loader2 className="spin" size={18} /> : <Cloud size={18} />}
                                Upload Cloud
                                <input accept="audio/*" disabled={cloudUploadBusy} multiple onChange={uploadCloudFileToPlaylist} type="file" />
                              </label>
                            )}
                          </div>
                          <div className="playlist-more-wrap">
                            <button
                              aria-label="Options playlist"
                              className={playlistMenuOpen ? 'playlist-more-button active' : 'playlist-more-button'}
                              onClick={() => setPlaylistMenuOpen((open) => !open)}
                              type="button"
                            >
                              <MoreHorizontal size={24} />
                            </button>
                            {playlistMenuOpen && (
                              <div className="playlist-more-menu">
                                <button onClick={() => {
                                  copyInviteCode(activePlaylist);
                                  setPlaylistMenuOpen(false);
                                }} type="button">
                                  <Copy size={17} />
                                  <span>Copier code</span>
                                  <small>{activePlaylist.inviteCode}</small>
                                </button>
                                <button onClick={() => {
                                  setPlaylistPanel((panel) => (panel === 'members' ? null : 'members'));
                                  setPlaylistMenuOpen(false);
                                }} type="button">
                                  <Users size={17} />
                                  <span>Membres</span>
                                </button>
                                {activePlaylistCanManage && (
                                  <button onClick={() => {
                                    setPlaylistPanel((panel) => (panel === 'customize' ? null : 'customize'));
                                    setPlaylistMenuOpen(false);
                                  }} type="button">
                                    <Palette size={17} />
                                    <span>Personnaliser</span>
                                  </button>
                                )}
                                {activePlaylistCanEdit && activePlaylist.tracks.length > 0 && (
                                  <button onClick={() => {
                                    startTrackSelection('playlist');
                                    setPlaylistMenuOpen(false);
                                  }} type="button">
                                    <ListChecks size={17} />
                                    <span>Selection titres</span>
                                  </button>
                                )}
                                {activePlaylistCanManage && (
                                  <button onClick={() => {
                                    void regenerateInviteCode(activePlaylist);
                                    setPlaylistMenuOpen(false);
                                  }} type="button">
                                    <Sparkles size={17} />
                                    <span>Generer un code</span>
                                  </button>
                                )}
                                {activePlaylistCanManage && (
                                  <button className="danger" onClick={() => {
                                    void deletePlaylist(activePlaylist);
                                    setPlaylistMenuOpen(false);
                                  }} type="button">
                                    <Trash2 size={17} />
                                    <span>Supprimer</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {playlistPanel === 'customize' && activePlaylistCanManage && (
                          <section className="playlist-panel playlist-customize-panel">
                            <div className="section-title">
                              <Palette size={16} />
                              Personnaliser
                            </div>
                            <form className="playlist-customize-form" onSubmit={renamePlaylist}>
                              <label>
                                Nom de la playlist
                                <input
                                  value={playlistNameDraft}
                                  onChange={(event) => setPlaylistNameDraft(event.target.value)}
                                  maxLength={80}
                                />
                              </label>
                              <button className="code-pill" disabled={playlistBusy || !playlistNameDraft.trim() || playlistNameDraft.trim() === activePlaylist.name} type="submit">
                                <Check size={16} />
                                Sauvegarder
                              </button>
                            </form>
                            <label className={playlistBusy ? 'playlist-cover-picker disabled' : 'playlist-cover-picker'}>
                              <ImageIcon size={18} />
                              <span>{activePlaylist.coverUrl ? 'Changer la photo' : 'Ajouter une photo'}</span>
                              <input accept="image/*" disabled={playlistBusy} onChange={selectPlaylistCover} type="file" />
                            </label>
                          </section>
                        )}

                        {playlistPanel === 'members' && (
                          <section className="playlist-panel playlist-admin-panel">
                            <div className="section-title">
                              <Shield size={16} />
                              Membres
                            </div>
                            <div className="member-manage-list">
                              {activePlaylist.members.map((member) => (
                                <article className="member-manage-row" key={member.userId}>
                                  <ProfileAvatar avatarUrl={member.avatarUrl} className="member-manage-avatar" label={member.displayName} />
                                  <div>
                                    <strong>{member.displayName}</strong>
                                    <span>{roleLabel(member.role)}</span>
                                  </div>
                                  {member.role === 'owner' ? (
                                    <span className="role-pill">Proprietaire</span>
                                  ) : activePlaylistCanManage ? (
                                    <>
                                      <select
                                        disabled={playlistBusy}
                                        onChange={(event) => updatePlaylistMemberRole(member, event.target.value as PlaylistRole)}
                                        value={member.role}
                                      >
                                        <option value="editor">Editeur</option>
                                        <option value="listener">Lecteur</option>
                                      </select>
                                      <button aria-label="Retirer le membre" disabled={playlistBusy} onClick={() => removePlaylistMember(member)} type="button">
                                        <UserMinus size={16} />
                                      </button>
                                    </>
                                  ) : (
                                    <span className="role-pill neutral">{roleLabel(member.role)}</span>
                                  )}
                                </article>
                              ))}
                            </div>
                          </section>
                        )}

                        {selectionActive && activePlaylist.tracks.length > 0 && (
                          <div className="bulk-action-bar">
                            <button className="muted-action" onClick={toggleSelectAllTracks} type="button">
                              {allSelectableTracksSelected ? 'Tout deselectionner' : 'Tout selectionner'}
                            </button>
                            <span>{selectedTracks.length} selectionne{selectedTracks.length > 1 ? 's' : ''}</span>
                            {selectedTracks.length > 0 && (
                              <>
                                <button className="muted-action" onClick={clearTrackSelection} type="button">
                                  Annuler
                                </button>
                                <button className="danger-action" disabled={selectionDeleteBusy} onClick={deleteSelectedTracks} type="button">
                                  <Trash2 size={16} />
                                  Retirer
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        <div className="playlist-track-list">
                          {activePlaylist.tracks.length ? activePlaylist.tracks.map((track, index) => (
                            <article
                              className={[
                                'playlist-track-row',
                                selectionActive ? 'selecting' : '',
                                currentTrack?.id === track.id ? 'active' : '',
                                selectedTrackIds.has(track.id) ? 'selected' : '',
                              ].filter(Boolean).join(' ')}
                              key={`${track.id}-${index}`}
                            >
                              {selectionActive && (
                                <label className="playlist-row-select" aria-label={`Selectionner ${track.title}`}>
                                  <input
                                    checked={selectedTrackIds.has(track.id)}
                                    onChange={() => toggleTrackSelection(track)}
                                    type="checkbox"
                                  />
                                  <span />
                                </label>
                              )}
                              <button className="playlist-row-cover" onClick={() => playTrack(track, activePlaylist.tracks, index)} type="button">
                                {track.thumbnail ? <img src={track.thumbnail} alt="" loading="lazy" /> : <span />}
                                <i>{currentTrack?.id === track.id && playing ? <PlayingBars className="cover-playing-bars" /> : <Play size={17} />}</i>
                              </button>
                              <div className="playlist-row-copy">
                                <div className="playlist-row-title-line">
                                  <h3>{track.title}</h3>
                                </div>
                                <p>{track.channel}</p>
                                <AddedByLine track={track} />
                              </div>
                              <span className="duration">{track.duration || '--:--'}</span>
                              <div className="track-actions playlist-row-actions">
                                <button className={savedIds.has(track.id) ? 'saved' : ''} aria-label="Sauvegarder" onClick={() => toggleSave(track)} type="button">
                                  <Heart size={17} />
                                </button>
                                {activePlaylistCanEdit && (
                                  <button aria-label="Retirer de la playlist" onClick={() => removeTrackFromPlaylist(track)} type="button">
                                    <Trash2 size={17} />
                                  </button>
                                )}
                                {track.source !== 'cloud' && (
                                  <button aria-label="Telecharger via yt-dlp" disabled={downloadBusy[track.id]} onClick={() => requestDownload(track)} type="button">
                                    {downloadBusy[track.id] ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                                  </button>
                                )}
                              </div>
                            </article>
                          )) : (
                            <div className="empty-state playlist-empty">
                              <Search size={28} />
                              Playlist vide
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        <ListMusic size={28} />
                        Cree une playlist ou rejoins-en une avec un code.
                      </div>
                    )}
                  </section>
                ) : (
                  <>
                    {view === 'cloud' && selectionActive && cloudTracks.length > 0 && (
                      <div className="bulk-action-bar">
                        <button className="muted-action" onClick={toggleSelectAllTracks} type="button">
                          {allSelectableTracksSelected ? 'Tout deselectionner' : 'Tout selectionner'}
                        </button>
                        <span>{selectedTracks.length} selectionne{selectedTracks.length > 1 ? 's' : ''}</span>
                        {selectedTracks.length > 0 && (
                          <>
                            <button className="muted-action" onClick={clearTrackSelection} type="button">
                              Annuler
                            </button>
                            <button className="danger-action" disabled={selectionDeleteBusy} onClick={deleteSelectedTracks} type="button">
                              <Trash2 size={16} />
                              Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <section className="track-grid">
                      {loading && !visibleTracks.length ? (
                        <div className="empty-state">
                          <Loader2 className="spin" size={28} />
                          Chargement
                        </div>
                      ) : visibleTracks.length ? (
                        visibleTracks.map((track, index) => (
                          <article
                            className={[
                              'track-card',
                              selectionActive ? 'selecting' : '',
                              currentTrack?.id === track.id ? 'active' : '',
                              selectedTrackIds.has(track.id) ? 'selected' : '',
                            ].filter(Boolean).join(' ')}
                            key={`${track.id}-${index}`}
                          >
                            {view === 'cloud' && selectionActive && (
                              <label className="track-select" aria-label={`Selectionner ${track.title}`}>
                                <input
                                  checked={selectedTrackIds.has(track.id)}
                                  onChange={() => toggleTrackSelection(track)}
                                  type="checkbox"
                                />
                                <span />
                              </label>
                            )}
                            <button className="cover-button" onClick={() => playTrack(track, visibleTracks, index)} type="button">
                              {track.thumbnail ? <img src={track.thumbnail} alt="" loading="lazy" /> : <span />}
                              <i>{currentTrack?.id === track.id && playing ? <PlayingBars className="cover-playing-bars" /> : <Play size={22} />}</i>
                            </button>
                            <div className="track-copy">
                              <div className="track-title-line">
                                <h2>{track.title}</h2>
                              </div>
                              <p>{track.channel}</p>
                            </div>
                            <span className="duration">{track.duration || '--:--'}</span>
                            <div className="track-actions">
                              <button className={savedIds.has(track.id) ? 'saved' : ''} aria-label="Sauvegarder" onClick={() => toggleSave(track)} type="button">
                                <Heart size={17} />
                              </button>
                              <button aria-label="Ajouter a la playlist" disabled={!playlistTarget || !playlistTargetCanEdit} onClick={() => addTrackToPlaylist(track)} type="button">
                                <Plus size={17} />
                              </button>
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
                          {view === 'cloud' ? 'Aucune musique Cloud' : 'Aucun titre'}
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
          </>
        )}
      </main>

      {user && (
        <footer className="player">
          <div className="now-playing">
            <div className="now-playing-art">
              {currentTrack?.thumbnail ? (
                <img src={currentTrack.thumbnail} alt="" />
              ) : (
                <div className="empty-cover" />
              )}
              {currentTrack && playing && <PlayingBars className="cover-playing-bars" />}
            </div>
            <div className="now-playing-copy">
              <div className="now-title-line">
                <strong>{currentTrack?.title || 'Aucun titre'}</strong>
              </div>
              <span>{currentTrack?.channel || 'Flowify'}</span>
            </div>
          </div>

          <div className="player-controls">
            <button aria-label="Aleatoire" className={shuffleEnabled ? 'active' : ''} onClick={() => setShuffleEnabled((enabled) => !enabled)} type="button">
              <Shuffle size={19} />
            </button>
            <button aria-label="Precedent" onClick={() => playOffset(-1)} type="button">
              <SkipBack size={20} />
            </button>
            <button className="play-toggle" aria-label="Lecture" disabled={!currentTrack} onClick={togglePlay} type="button">
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button aria-label="Suivant" onClick={() => playOffset(1)} type="button">
              <SkipForward size={20} />
            </button>
            <button aria-label="Repeter" className={repeatEnabled ? 'active' : ''} onClick={() => setRepeatEnabled((enabled) => !enabled)} type="button">
              <Repeat size={19} />
            </button>
            <div className={volumeOpen ? 'volume-menu open' : 'volume-menu'}>
              <button aria-label="Volume" className={volumeOpen ? 'active' : ''} onClick={() => setVolumeOpen((open) => !open)} type="button">
                <Volume2 size={20} />
              </button>
              <input
                aria-label="Volume"
                className="volume-slider"
                max="1"
                min="0"
                onChange={(event) => setVolume(Number(event.target.value))}
                step="0.01"
                style={{ background: `linear-gradient(to right, var(--green) 0%, var(--green) ${Math.round(volume * 100)}%, #4c4c4c ${Math.round(volume * 100)}%, #4c4c4c 100%)` }}
                type="range"
                value={volume}
              />
            </div>
          </div>

          <div className="progress-wrap">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Progression"
              min="0"
              max={duration || 0}
              step="1"
              value={Math.min(currentTime, duration || 0)}
              style={{ background: `linear-gradient(to right, var(--green) 0%, var(--green) ${playbackProgress}%, #4c4c4c ${playbackProgress}%, #4c4c4c 100%)` }}
              disabled={!duration}
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                seekCurrentTrack(nextTime);
              }}
              type="range"
            />
            <span>{formatTime(duration)}</span>
          </div>
          <div className={youtubeVideoId ? 'youtube-player-shell active' : 'youtube-player-shell'} aria-hidden={currentTrack?.source === 'cloud'}>
            <div ref={youtubeContainerRef} />
          </div>
        </footer>
      )}
    </div>
  );
}

function getInitialVolume() {
  const saved = Number(localStorage.getItem('flowify.volume'));
  if (Number.isFinite(saved)) return Math.min(1, Math.max(0, saved));
  return 1;
}

function getAuthRedirectUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

function isThemeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function readThemeColor(key: string, fallback: string) {
  try {
    const saved = localStorage.getItem(key) || '';
    return isThemeColor(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function applyThemeColors(primary: string, secondary: string) {
  if (typeof document === 'undefined') return;
  const nextPrimary = isThemeColor(primary) ? primary : DEFAULT_PRIMARY_COLOR;
  const nextSecondary = isThemeColor(secondary) ? secondary : DEFAULT_SECONDARY_COLOR;
  const root = document.documentElement;
  root.style.setProperty('--cyan', nextPrimary);
  root.style.setProperty('--green', nextPrimary);
  root.style.setProperty('--violet', nextSecondary);
  root.style.setProperty('--accent-primary', nextPrimary);
  root.style.setProperty('--accent-secondary', nextSecondary);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextSecondary);
}

function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('Lecteur YouTube indisponible.'));
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => reject(new Error('Impossible de charger le lecteur YouTube.'));
      document.head.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

function displayNameFromEmail(value?: string | null) {
  return value?.split('@')[0] || '';
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`
    : value.trim().slice(0, 2);
  return (letters || 'F').toUpperCase();
}

function ProfileAvatar({
  avatarUrl,
  className = '',
  label,
}: {
  avatarUrl?: string | null;
  className?: string;
  label: string;
}) {
  const cleanUrl = avatarUrl?.trim();
  const classNames = ['profile-avatar', className].filter(Boolean).join(' ');
  if (cleanUrl) {
    return <img className={classNames} src={cleanUrl} alt="" loading="lazy" />;
  }

  return (
    <span className={classNames} aria-hidden="true">
      {initials(label)}
    </span>
  );
}

function PlaylistCover({ playlist }: { playlist: Playlist }) {
  if (playlist.coverUrl) {
    return (
      <div className="playlist-cover-art single">
        <img src={playlist.coverUrl} alt="" loading="lazy" />
      </div>
    );
  }

  const covers = playlist.tracks.filter((track) => track.thumbnail).slice(0, 4);
  if (!covers.length) {
    return (
      <div className="playlist-cover-art fallback">
        <img src={`${import.meta.env.BASE_URL}flowify-logo.png`} alt="" />
      </div>
    );
  }

  return (
    <div className={covers.length === 1 ? 'playlist-cover-art single' : 'playlist-cover-art'}>
      {covers.map((track) => (
        <img key={track.id} src={track.thumbnail} alt="" loading="lazy" />
      ))}
    </div>
  );
}

function PlaylistSidebarCover({ playlist }: { playlist: Playlist }) {
  const image = playlistHeroImage(playlist);
  return (
    <span className="playlist-sidebar-cover" aria-hidden="true">
      {image ? <img src={image} alt="" loading="lazy" /> : <ListMusic size={16} />}
    </span>
  );
}

function AddedByLine({ track }: { track: Track }) {
  const addedBy = track.addedBy;
  const label = addedBy?.displayName || 'Membre Flowify';
  return (
    <span className="added-by-line">
      <ProfileAvatar avatarUrl={addedBy?.avatarUrl} className="added-by-avatar" label={label} />
      Ajoute par {label}
    </span>
  );
}

function PlayingBars({ className = '' }: { className?: string }) {
  return (
    <span className={['playing-bars', className].filter(Boolean).join(' ')} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function playlistHeroImage(playlist: Playlist) {
  return playlist.coverUrl || playlist.tracks.find((track) => track.thumbnail)?.thumbnail || '';
}

function profileToPlaylistMember(userId: string, profile?: Profile): PlaylistMember {
  return {
    userId,
    role: 'listener',
    displayName: profile?.display_name || displayNameFromEmail(profile?.email) || 'Membre',
    avatarUrl: profile?.avatar_url || '',
  };
}

function roleLabel(role: PlaylistRole) {
  if (role === 'owner') return 'Proprietaire';
  if (role === 'editor') return 'Editeur';
  return 'Lecteur';
}

function normalizePlaylistRole(role: string): PlaylistRole {
  if (role === 'owner' || role === 'editor' || role === 'listener') return role;
  return 'editor';
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

function getPlaylistStartIndex(length: number, shuffle: boolean) {
  if (length <= 0) return 0;
  if (!shuffle || length === 1) return 0;
  return 1 + Math.floor(Math.random() * (length - 1));
}

async function extractEmbeddedCover(file: File) {
  const isMp3 = file.type === 'audio/mpeg' || /\.(mp3|mpeg)$/i.test(file.name);
  if (!isMp3) return '';

  try {
    const buffer = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer();
    const picture = findId3Picture(new Uint8Array(buffer));
    if (!picture) return '';
    const pictureBuffer = new ArrayBuffer(picture.data.byteLength);
    new Uint8Array(pictureBuffer).set(picture.data);
    return await resizeArtworkBlob(new Blob([pictureBuffer], { type: picture.mimeType || 'image/jpeg' }));
  } catch {
    return '';
  }
}

function findId3Picture(bytes: Uint8Array): { mimeType: string; data: Uint8Array } | null {
  if (bytes.length < 10 || readAscii(bytes, 0, 3) !== 'ID3') return null;

  const version = bytes[3];
  const flags = bytes[5];
  const tagEnd = Math.min(bytes.length, 10 + readSynchsafeInteger(bytes, 6));
  let offset = 10;

  if (flags & 0x40) {
    const extendedSize = version === 4 ? readSynchsafeInteger(bytes, offset) : readBigEndianInteger(bytes, offset, 4);
    offset += version === 4 ? extendedSize : extendedSize + 4;
  }

  while (offset + (version === 2 ? 6 : 10) <= tagEnd) {
    const frameId = readAscii(bytes, offset, version === 2 ? 3 : 4);
    if (!frameId.trim() || /^\0+$/.test(frameId)) break;

    const frameSize = version === 2
      ? readBigEndianInteger(bytes, offset + 3, 3)
      : version === 4
        ? readSynchsafeInteger(bytes, offset + 4)
        : readBigEndianInteger(bytes, offset + 4, 4);
    const frameStart = offset + (version === 2 ? 6 : 10);
    const frameEnd = frameStart + frameSize;
    if (frameSize <= 0 || frameEnd > tagEnd) break;

    if (frameId === 'APIC' || frameId === 'PIC') {
      const parsed = parsePictureFrame(bytes, frameStart, frameEnd, frameId);
      if (parsed) return parsed;
    }

    offset = frameEnd;
  }

  return null;
}

function parsePictureFrame(bytes: Uint8Array, start: number, end: number, frameId: string) {
  if (start >= end) return null;
  const encoding = bytes[start];
  let cursor = start + 1;
  let mimeType = 'image/jpeg';

  if (frameId === 'PIC') {
    const format = readAscii(bytes, cursor, 3).toLowerCase();
    mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    cursor += 3;
  } else {
    const mimeEnd = findZeroByte(bytes, cursor, end);
    if (mimeEnd === -1) return null;
    mimeType = readAscii(bytes, cursor, mimeEnd - cursor) || mimeType;
    cursor = mimeEnd + 1;
  }

  cursor += 1;
  const terminatorLength = encoding === 1 || encoding === 2 ? 2 : 1;
  cursor = skipEncodedText(bytes, cursor, end, terminatorLength);
  if (cursor >= end) return null;

  return {
    mimeType,
    data: bytes.slice(cursor, end),
  };
}

function skipEncodedText(bytes: Uint8Array, start: number, end: number, terminatorLength: number) {
  let cursor = start;
  while (cursor + terminatorLength <= end) {
    if (
      (terminatorLength === 1 && bytes[cursor] === 0) ||
      (terminatorLength === 2 && bytes[cursor] === 0 && bytes[cursor + 1] === 0)
    ) {
      return cursor + terminatorLength;
    }
    cursor += terminatorLength === 2 ? 2 : 1;
  }
  return end;
}

function findZeroByte(bytes: Uint8Array, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

function readAscii(bytes: Uint8Array, start: number, length: number) {
  let value = '';
  for (let index = 0; index < length && start + index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[start + index]);
  }
  return value;
}

function readBigEndianInteger(bytes: Uint8Array, start: number, length: number) {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = (value << 8) + (bytes[start + index] || 0);
  }
  return value;
}

function readSynchsafeInteger(bytes: Uint8Array, start: number) {
  return (
    ((bytes[start] || 0) & 0x7f) << 21 |
    ((bytes[start + 1] || 0) & 0x7f) << 14 |
    ((bytes[start + 2] || 0) & 0x7f) << 7 |
    ((bytes[start + 3] || 0) & 0x7f)
  );
}

function resizeArtworkBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const size = 320;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        resolve('');
        return;
      }

      const ratio = Math.max(size / image.width, size / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve('');
    };
    image.src = objectUrl;
  });
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
  if (message.includes('Entre ta cle YouTube Data API v3')) {
    return '';
  }
  if (message.includes('playlists.invite_code')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes("Could not find the 'invite_code' column")) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (message.includes("Could not find the 'cover_url' column") || message.includes('playlists.cover_url')) {
    return 'Base Supabase pas a jour: ajoute la colonne cover_url aux playlists avec supabase/fix-existing-database.sql.';
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
  if (message.includes('null value in column "track_id"') && message.includes('playlist_tracks')) {
    return 'Base Supabase pas a jour: execute le bloc SQL final pour rendre track_id compatible.';
  }
  if (message.includes('Could not find the function public.delete_playlist')) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql dans le SQL editor.';
  }
  if (
    message.includes('Could not find the function public.update_playlist_name') ||
    message.includes('Could not find the function public.update_playlist_member_role') ||
    message.includes('Could not find the function public.remove_playlist_member')
  ) {
    return 'Base Supabase pas a jour: execute supabase/fix-existing-database.sql pour activer renommage et permissions.';
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
