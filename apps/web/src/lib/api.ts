import type { ApiHealth, SearchResult, Track } from '../types';

const API_URL_STORAGE_KEY = 'flowify-api-url';
const YOUTUBE_KEY_STORAGE_KEY = 'flowify-youtube-api-key';

const configuredApiUrl = import.meta.env.VITE_FLOWIFY_API_URL as string | undefined;
const defaultDevApiUrl = import.meta.env.DEV ? 'http://localhost:8787' : '';
const fallbackApiUrl = trimTrailingSlash(configuredApiUrl || defaultDevApiUrl);

export function getApiBaseUrl(): string {
  return trimTrailingSlash(readStorage(API_URL_STORAGE_KEY) || fallbackApiUrl);
}

export function getYoutubeApiKey(): string {
  return readStorage(YOUTUBE_KEY_STORAGE_KEY);
}

export function saveApiBaseUrl(value: string): void {
  writeStorage(API_URL_STORAGE_KEY, trimTrailingSlash(value));
}

export function saveYoutubeApiKey(value: string): void {
  writeStorage(YOUTUBE_KEY_STORAGE_KEY, value.trim());
}

export function clearYoutubeApiKey(): void {
  writeStorage(YOUTUBE_KEY_STORAGE_KEY, '');
}

export function isApiConfigured(): boolean {
  return Boolean(getApiBaseUrl());
}

export async function getHealth(): Promise<ApiHealth> {
  return request<ApiHealth>('/health');
}

export async function searchTracks(query: string, pageToken = ''): Promise<SearchResult> {
  const params = new URLSearchParams({ query, maxResults: '24' });
  if (pageToken) params.set('pageToken', pageToken);
  return request<SearchResult>(`/api/search?${params}`);
}

export async function getTrending(): Promise<SearchResult> {
  return request<SearchResult>('/api/trending?regionCode=FR&maxResults=24');
}

export async function resolveYouTubeUrl(url: string): Promise<SearchResult> {
  return request<SearchResult>(`/api/resolve?url=${encodeURIComponent(url)}`);
}

export async function downloadTrack(track: Track): Promise<{ filename: string; url: string }> {
  return request(`/api/download/${encodeURIComponent(track.id)}`, {
    method: 'POST',
  });
}

export function streamUrl(track: Track): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return '';
  return `${baseUrl}/api/stream/${encodeURIComponent(track.id)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error('API Flowify non configuree');
  }

  const headers = new Headers(init?.headers);
  const youtubeKey = getYoutubeApiKey();
  if (youtubeKey) headers.set('X-YouTube-Api-Key', youtubeKey);

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Erreur API ${response.status}`);
  }
  return payload as T;
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

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
