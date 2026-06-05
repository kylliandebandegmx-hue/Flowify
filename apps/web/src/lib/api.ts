import type { ApiHealth, SearchResult, Track } from '../types';

const YOUTUBE_KEY_STORAGE_KEY = 'flowify-youtube-api-key';
const FLOWIFY_API_STORAGE_KEY = 'flowify-api-base-url';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
// Fallback immédiat synchrone : VITE env > localStorage > URL Render hardcodée.
// flowify-config.json (async) peut surcharger cette valeur dans detectApiHealth().
const FALLBACK_API_URL = 'https://flowify-api.onrender.com';
let flowifyApiBase = normalizeApiBase(
  import.meta.env.VITE_FLOWIFY_API_URL ||
  readStorage(FLOWIFY_API_STORAGE_KEY) ||
  FALLBACK_API_URL,
);
const signedCloudUrlCache = new Map<string, { expiresAt: number; url: string }>();

export interface CloudQueueStreamSegment {
  duration: number;
  end: number;
  index: number;
  key: string;
  start: number;
  title: string;
}

export interface CloudQueueStream {
  duration: number;
  id: string;
  segments: CloudQueueStreamSegment[];
  url: string;
}

export function getYoutubeApiKey(): string {
  return readStorage(YOUTUBE_KEY_STORAGE_KEY);
}

export function saveYoutubeApiKey(value: string): void {
  writeStorage(YOUTUBE_KEY_STORAGE_KEY, value.trim());
}

export function clearYoutubeApiKey(): void {
  writeStorage(YOUTUBE_KEY_STORAGE_KEY, '');
}

export function getFlowifyApiBaseUrl(): string {
  return flowifyApiBase;
}

export function saveFlowifyApiBaseUrl(value: string): void {
  flowifyApiBase = normalizeApiBase(value);
  writeStorage(FLOWIFY_API_STORAGE_KEY, flowifyApiBase);
}

export function clearFlowifyApiBaseUrl(): void {
  writeStorage(FLOWIFY_API_STORAGE_KEY, '');
  flowifyApiBase = normalizeApiBase(import.meta.env.VITE_FLOWIFY_API_URL || '');
}

export async function getHealth(): Promise<ApiHealth> {
  const youtubeConfigured = Boolean(getYoutubeApiKey());
  const apiHealth = await detectApiHealth();
  if (apiHealth) {
    return {
      ok: apiHealth.ok || youtubeConfigured,
      youtubeConfigured: Boolean(apiHealth.youtubeConfigured || youtubeConfigured),
      ytdlpAvailable: Boolean(apiHealth.ytdlpAvailable),
      apiReachable: true,
      cloudStorageAvailable: Boolean(apiHealth.cloudStorageAvailable),
      cloudPublicBaseUrl: Boolean(apiHealth.cloudPublicBaseUrl),
    };
  }

  return {
    ok: youtubeConfigured,
    youtubeConfigured,
    ytdlpAvailable: false,
    apiReachable: false,
  };
}

export async function searchTracks(query: string, pageToken = ''): Promise<SearchResult> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10',
    maxResults: '24',
    order: 'relevance',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const search = await youtubeFetch<YouTubeSearchResponse>('/search', params);
  const ids = search.items.map((item) => item.id.videoId).filter(Boolean);
  const details = await getVideoDetails(ids);

  return {
    tracks: search.items
      .map((item) => trackFromSnippet(item.id.videoId, item.snippet, details.get(item.id.videoId)))
      .filter((track): track is Track => Boolean(track)),
    nextPageToken: search.nextPageToken || '',
    totalResults: search.pageInfo?.totalResults || 0,
  };
}

export async function getTrending(): Promise<SearchResult> {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics',
    chart: 'mostPopular',
    videoCategoryId: '10',
    regionCode: 'FR',
    maxResults: '24',
  });

  const data = await youtubeFetch<YouTubeVideosResponse>('/videos', params);
  return {
    tracks: data.items.map((item) => trackFromVideo(item)),
    nextPageToken: '',
    totalResults: data.items.length,
  };
}

export async function resolveYouTubeUrl(url: string): Promise<SearchResult> {
  const { videoId, playlistId } = parseYouTubeUrl(url);
  if (playlistId && !videoId) return getPlaylistTracks(playlistId);
  if (!videoId) throw new Error('URL YouTube non reconnue');

  const details = await getVideoDetails([videoId]);
  const item = details.get(videoId);
  if (!item) throw new Error('Video introuvable');

  return {
    tracks: [trackFromVideo(item)],
    nextPageToken: '',
    totalResults: 1,
  };
}

export async function downloadTrack(_track?: Track): Promise<{ filename: string; url: string }> {
  if (!_track) throw new Error('Aucun titre a telecharger.');
  await detectApiHealth();
  if (!flowifyApiBase) {
    throw new Error('Telechargement yt-dlp indisponible: configure FLOWIFY_API_URL.');
  }

  const response = await fetch(apiUrl(`/api/download/${encodeURIComponent(_track.id)}`), {
    method: 'POST',
    headers: apiHeaders(),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Erreur telechargement ${response.status}`);
  return {
    filename: payload.filename,
    url: apiUrl(payload.url),
  };
}

export async function uploadCloudTrack(file: File): Promise<{
  key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}> {
  await detectApiHealth();
  if (!flowifyApiBase) {
    throw new Error('Upload Cloud indisponible: configure URL API Flowify.');
  }
  if (!file.type.startsWith('audio/')) {
    throw new Error('Choisis un fichier audio.');
  }

  const response = await fetch(apiUrl('/api/cloud/upload'), {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Erreur upload Cloud ${response.status}`);
  return payload;
}

export async function deleteCloudTrackObject(storageKey: string): Promise<void> {
  await detectApiHealth();
  if (!flowifyApiBase) {
    throw new Error('Suppression Cloud indisponible: configure URL API Flowify.');
  }

  const response = await fetch(apiUrl('/api/cloud/delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: storageKey }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Erreur suppression Cloud ${response.status}`);
}

export async function createCloudQueueStream(tracks: Track[]): Promise<CloudQueueStream> {
  await detectApiHealth();
  if (!flowifyApiBase) {
    throw new Error('Lecture Cloud PWA indisponible: configure URL API Flowify.');
  }

  const queueTracks = tracks
    .filter((track) => track.source === 'cloud' && track.storageKey)
    .map((track) => ({
      contentType: track.contentType || 'audio/mpeg',
      durationSeconds: parseTrackDuration(track.duration),
      key: track.storageKey,
      title: track.title,
    }));

  if (!queueTracks.length) throw new Error('File Cloud vide.');

  const response = await fetch(apiUrl('/api/cloud/queue-streams'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracks: queueTracks }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Erreur file Cloud ${response.status}`);

  return {
    duration: Number(payload.duration || 0),
    id: String(payload.id || ''),
    segments: Array.isArray(payload.segments)
      ? payload.segments.map((segment: Partial<CloudQueueStreamSegment>) => ({
        duration: Number(segment.duration || 0),
        end: Number(segment.end || 0),
        index: Number(segment.index || 0),
        key: String(segment.key || ''),
        start: Number(segment.start || 0),
        title: String(segment.title || ''),
      }))
      : [],
    url: apiUrl(String(payload.url || '')),
  };
}

export async function resolveCloudPlaybackUrl(track: Track): Promise<string> {
  if (!track.storageKey) {
    throw new Error('Clé Cloud manquante: le fichier n\'a pas été uploadé correctement.');
  }

  // Fallback immédiat : proxy stream direct via l'API (plus stable)
  const directUrl = cloudStreamUrl(track);
  if (directUrl) {
    return directUrl;
  }

  // Détection API en arrière-plan, sans bloquer
  if (!flowifyApiBase) {
    detectApiHealth().catch(() => undefined);
  }

  throw new Error(
    'API Flowify non configurée. Va dans Paramètres > URL API Flowify et entre l\'URL de ton serveur Render.',
  );
}

export function streamUrl(track: Track | string): string {
  if (!flowifyApiBase) return '';
  const videoId = typeof track === 'string' ? track : track.id;
  return apiUrl(`/api/stream/${encodeURIComponent(videoId)}?play=${Date.now()}`);
}

export function cloudStreamUrl(track: Track): string {
  if (track.url) return track.url;
  if (track.storageKey) {
    const base = flowifyApiBase || sameOriginApiBase() || '';
    if (base) {
      return `${base}/api/cloud/stream?key=${encodeURIComponent(track.storageKey)}&play=${Date.now()}`;
    }
  }
  return '';
}

export function hasYtdlpAudioApi(): boolean {
  return Boolean(flowifyApiBase);
}

async function getPlaylistTracks(playlistId: string): Promise<SearchResult> {
  const params = new URLSearchParams({
    part: 'snippet',
    playlistId,
    maxResults: '50',
  });
  const data = await youtubeFetch<YouTubePlaylistResponse>('/playlistItems', params);
  const ids = data.items
    .map((item) => item.snippet.resourceId?.videoId)
    .filter((id): id is string => Boolean(id));
  const details = await getVideoDetails(ids);

  return {
    tracks: ids
      .map((id) => details.get(id))
      .filter((item): item is YouTubeVideoItem => Boolean(item))
      .map((item) => trackFromVideo(item)),
    nextPageToken: data.nextPageToken || '',
    totalResults: ids.length,
  };
}

async function getVideoDetails(ids: string[]): Promise<Map<string, YouTubeVideoItem>> {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  if (!cleanIds.length) return new Map();

  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics',
    id: cleanIds.join(','),
  });
  const data = await youtubeFetch<YouTubeVideosResponse>('/videos', params);
  return new Map(data.items.map((item) => [item.id, item]));
}

async function youtubeFetch<T>(endpoint: string, params: URLSearchParams): Promise<T> {
  const key = getYoutubeApiKey();
  if (!key) {
    throw new Error('Entre ta cle YouTube Data API v3 dans Parametres.');
  }

  params.set('key', key);
  const response = await fetch(`${YOUTUBE_API_BASE}${endpoint}?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Erreur YouTube ${response.status}`);
  }
  return payload as T;
}

function trackFromSnippet(id: string, snippet: YouTubeSnippet, details?: YouTubeVideoItem): Track | null {
  if (!id) return null;
  return {
    id,
    title: decodeText(snippet.title || 'Titre inconnu'),
    channel: decodeText(snippet.channelTitle || ''),
    thumbnail: bestThumbnail(snippet.thumbnails),
    duration: details?.contentDetails?.duration ? parseDuration(details.contentDetails.duration) : '',
    viewCount: details?.statistics?.viewCount || '',
    publishedAt: snippet.publishedAt || '',
    description: decodeText(snippet.description || ''),
  };
}

function trackFromVideo(item: YouTubeVideoItem): Track {
  return trackFromSnippet(item.id, item.snippet, item) as Track;
}

function bestThumbnail(thumbnails: YouTubeThumbnails = {}): string {
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ''
  );
}

function parseDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseYouTubeUrl(rawUrl: string) {
  const videoMatch = rawUrl.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  const playlistMatch = rawUrl.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return {
    videoId: videoMatch?.[1] || '',
    playlistId: playlistMatch?.[1] || '',
  };
}

function decodeText(value: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() || '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

function apiHeaders(): HeadersInit {
  const key = getYoutubeApiKey();
  return key ? { 'X-YouTube-Api-Key': key } : {};
}

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${flowifyApiBase}${cleanPath}`;
}

function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/health$/i, '');
}

function parseTrackDuration(value: string): number {
  const parts = value
    .split(':')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (!parts.length) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function detectApiHealth(): Promise<ApiHealth | null> {
  const candidates = await apiBaseCandidates();

  // Assigner flowifyApiBase depuis la première URL connue, même sans
  // confirmation réseau — le health check peut être bloqué par un ad-blocker.
  if (!flowifyApiBase && candidates.length > 0) {
    flowifyApiBase = candidates[0];
  }

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${candidate}/health`, {
        headers: apiHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const payload = (await response.json()) as ApiHealth;
      if (response.ok) {
        flowifyApiBase = candidate;
        writeStorage(FLOWIFY_API_STORAGE_KEY, candidate);
        return {
          ok: Boolean(payload.ok),
          youtubeConfigured: Boolean(payload.youtubeConfigured),
          ytdlpAvailable: Boolean(payload.ytdlpAvailable),
          cloudStorageAvailable: Boolean(payload.cloudStorageAvailable),
          cloudPublicBaseUrl: Boolean(payload.cloudPublicBaseUrl),
        };
      }
    } catch {
      // Requête bloquée (ad-blocker) ou serveur hors ligne — on continue.
      // flowifyApiBase est déjà assigné plus haut, la lecture peut quand même fonctionner.
    }
  }

  // Le health check a échoué (ad-blocker, Render en veille, etc.)
  // mais on retourne un état partiel pour ne pas bloquer la lecture.
  if (flowifyApiBase) {
    return {
      ok: false,
      youtubeConfigured: false,
      ytdlpAvailable: false,
      apiReachable: false,
      cloudStorageAvailable: true, // Optimiste — R2 peut fonctionner sans /health
    };
  }

  return null;
}

async function apiBaseCandidates(): Promise<string[]> {
  const runtimeConfig = await readRuntimeConfig();
  const candidates = uniqueValues([
    flowifyApiBase,
    import.meta.env.VITE_FLOWIFY_API_URL,
    runtimeConfig.apiBaseUrl,
    readStorage(FLOWIFY_API_STORAGE_KEY),
    sameOriginApiBase(),
    defaultLocalApiBase(),
  ].map((value) => normalizeApiBase(value || '')));

  // Initialiser flowifyApiBase dès maintenant si possible, sans attendre
  // la confirmation du health check (qui peut être bloqué par un ad-blocker).
  if (!flowifyApiBase && candidates.length > 0) {
    flowifyApiBase = candidates[0];
    writeStorage(FLOWIFY_API_STORAGE_KEY, flowifyApiBase);
  }

  return candidates;
}

async function readRuntimeConfig(): Promise<{ apiBaseUrl?: string }> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}flowify-config.json`, {
      cache: 'no-store',
    });
    if (!response.ok) return {};
    const payload = await response.json();
    return {
      apiBaseUrl: typeof payload.apiBaseUrl === 'string' ? payload.apiBaseUrl : '',
    };
  } catch {
    return {};
  }
}

function sameOriginApiBase(): string {
  if (typeof window === 'undefined') return '';
  if (!['http:', 'https:'].includes(window.location.protocol)) return '';
  return window.location.origin;
}

function defaultLocalApiBase(): string {
  if (typeof window === 'undefined') return '';
  return ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port
    ? 'http://localhost:8787'
    : '';
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

interface YouTubeSearchResponse {
  items: Array<{
    id: { videoId: string };
    snippet: YouTubeSnippet;
  }>;
  nextPageToken?: string;
  pageInfo?: { totalResults: number };
}

interface YouTubeVideosResponse {
  items: YouTubeVideoItem[];
}

interface YouTubePlaylistResponse {
  items: Array<{
    snippet: YouTubeSnippet & {
      resourceId?: { videoId?: string };
    };
  }>;
  nextPageToken?: string;
}

interface YouTubeVideoItem {
  id: string;
  snippet: YouTubeSnippet;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
}

interface YouTubeSnippet {
  title?: string;
  description?: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnails?: YouTubeThumbnails;
}

interface YouTubeThumbnails {
  default?: { url: string };
  medium?: { url: string };
  high?: { url: string };
  standard?: { url: string };
  maxres?: { url: string };
}
