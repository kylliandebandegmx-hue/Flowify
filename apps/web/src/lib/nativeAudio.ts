import type { Track } from '../types';
import { cloudStreamUrl } from './api';

interface CapacitorPluginProxy {
  addListener?: (eventName: string, listener: (state: NativeAudioState) => void) => Promise<{ remove: () => Promise<void> }>;
  getState?: () => Promise<NativeAudioState>;
  next?: () => Promise<void>;
  pause?: () => Promise<void>;
  play?: () => Promise<void>;
  playQueue?: (payload: NativeAudioQueuePayload) => Promise<void>;
  previous?: () => Promise<void>;
  seek?: (payload: { position: number }) => Promise<void>;
  setModes?: (payload: { repeat: boolean; shuffle: boolean }) => Promise<void>;
  setVolume?: (payload: { volume: number }) => Promise<void>;
  stop?: () => Promise<void>;
}

interface NativeAudioQueuePayload {
  index: number;
  repeat: boolean;
  shuffle: boolean;
  tracks: NativeAudioTrack[];
  volume: number;
}

export interface NativeAudioTrack {
  artist: string;
  artwork: string;
  id: string;
  title: string;
  url: string;
}

export interface NativeAudioState {
  currentTime?: number;
  duration?: number;
  error?: string;
  id?: string;
  index?: number;
  playing?: boolean;
}

declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
      Plugins?: Record<string, CapacitorPluginProxy | undefined>;
    };
  }
}

function getNativeAudioPlugin() {
  return window.Capacitor?.Plugins?.FlowifyNativeAudio || null;
}

export function hasNativeAudio() {
  const capacitor = window.Capacitor;
  return Boolean(
    capacitor?.Plugins?.FlowifyNativeAudio &&
    (capacitor.isNativePlatform?.() || capacitor.getPlatform?.() === 'android'),
  );
}

export function toNativeAudioQueue(tracks: Track[]) {
  const nativeTracks = tracks.map((track) => {
    const url = cloudStreamUrl(track);
    if (!url) return null;
    return {
      artist: track.channel || 'Flowify',
      artwork: track.thumbnail || '',
      id: track.id,
      title: track.title,
      url,
    };
  });

  if (nativeTracks.some((track) => !track)) return null;
  return nativeTracks as NativeAudioTrack[];
}

export async function playNativeAudioQueue(payload: NativeAudioQueuePayload) {
  const plugin = getNativeAudioPlugin();
  if (!plugin?.playQueue) throw new Error('Lecteur natif Android indisponible.');
  await plugin.playQueue(payload);
}

export async function playNativeAudio() {
  await getNativeAudioPlugin()?.play?.();
}

export async function pauseNativeAudio() {
  await getNativeAudioPlugin()?.pause?.();
}

export async function stopNativeAudio() {
  await getNativeAudioPlugin()?.stop?.();
}

export async function seekNativeAudio(position: number) {
  await getNativeAudioPlugin()?.seek?.({ position });
}

export async function setNativeAudioVolume(volume: number) {
  await getNativeAudioPlugin()?.setVolume?.({ volume });
}

export async function setNativeAudioModes(shuffle: boolean, repeat: boolean) {
  await getNativeAudioPlugin()?.setModes?.({ shuffle, repeat });
}

export async function addNativeAudioStateListener(listener: (state: NativeAudioState) => void) {
  const plugin = getNativeAudioPlugin();
  if (!plugin?.addListener) return () => undefined;
  const handle = await plugin.addListener('nativeAudioState', listener);
  return () => {
    void handle.remove();
  };
}
