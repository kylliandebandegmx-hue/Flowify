/**
 * audioKeepAlive.ts
 *
 * Maintient la lecture audio active quand le téléphone est verrouillé.
 *
 * Stratégie :
 * 1. Un "silence audio" joué en boucle via AudioContext pour signaler
 *    au système que l'app est une app audio active.
 * 2. Un ping régulier vers le Service Worker pour l'empêcher de se mettre
 *    en veille.
 * 3. Visibilitychange listener pour reprendre l'AudioContext si suspendu.
 */

let audioCtx: AudioContext | null = null;
let silenceSource: AudioBufferSourceNode | null = null;
let swPingInterval: ReturnType<typeof setInterval> | null = null;
let keepAliveActive = false;

function createSilenceBuffer(ctx: AudioContext): AudioBuffer {
  // Buffer silencieux de 1 seconde — assez pour signaler l'activité audio
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, sampleRate, sampleRate);
  // Laisse les samples à 0 (silence) — le navigateur voit quand même
  // l'AudioContext comme actif
  return buffer;
}

function startSilenceLoop(ctx: AudioContext) {
  if (silenceSource) {
    try { silenceSource.stop(); } catch { /* ignore */ }
    silenceSource = null;
  }

  const buffer = createSilenceBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(ctx.destination);
  source.start(0);
  silenceSource = source;
}

async function ensureAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  return audioCtx;
}

function pingSW() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  const channel = new MessageChannel();
  navigator.serviceWorker.controller.postMessage('audio-playing', [channel.port2]);
}

export async function startAudioKeepAlive() {
  if (keepAliveActive) return;
  keepAliveActive = true;

  try {
    const ctx = await ensureAudioContext();
    startSilenceLoop(ctx);
  } catch {
    // AudioContext peut échouer si aucune interaction utilisateur — pas bloquant
  }

  // Ping toutes les 25 secondes pour garder le SW actif
  if (swPingInterval) clearInterval(swPingInterval);
  swPingInterval = setInterval(pingSW, 25_000);

  // Si l'AudioContext est suspendu (veille/focus perdu), le reprendre
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

export function stopAudioKeepAlive() {
  keepAliveActive = false;

  if (silenceSource) {
    try { silenceSource.stop(); } catch { /* ignore */ }
    silenceSource = null;
  }

  if (swPingInterval) {
    clearInterval(swPingInterval);
    swPingInterval = null;
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

async function handleVisibilityChange() {
  if (!keepAliveActive) return;
  if (document.visibilityState === 'visible') {
    // L'app reprend le focus — relancer AudioContext si suspendu
    try {
      const ctx = await ensureAudioContext();
      if (!silenceSource) {
        startSilenceLoop(ctx);
      }
    } catch { /* ignore */ }
  }
}

/**
 * Initialise l'AudioContext dès la première interaction utilisateur.
 * À appeler au tout premier clic/tap pour déverrouiller l'audio sur iOS.
 */
export function unlockAudioContext() {
  if (audioCtx && audioCtx.state !== 'closed') return;
  // Créer le contexte immédiatement dans l'événement utilisateur
  try {
    audioCtx = new AudioContext();
  } catch { /* ignore */ }
}
