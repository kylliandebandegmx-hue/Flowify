import type { ApiHealth, SearchResult, Track } from '../types';

const configuredApiUrl = import.meta.env.VITE_FLOWIFY_API_URL as string | undefined;
const defaultDevApiUrl = import.meta.env.DEV ? 'http://localhost:8787' : '';

export const apiBaseUrl = trimTrailingSlash(configuredApiUrl || defaultDevApiUrl);
export const isApiConfigured = Boolean(apiBaseUrl);

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
  if (!isApiConfigured) return '';
  return `${apiBaseUrl}/api/stream/${encodeURIComponent(track.id)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isApiConfigured) {
    throw new Error('API Flowify non configuree');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Erreur API ${response.status}`);
  }
  return payload as T;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
