import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const app = express();
const port = Number(process.env.PORT || 8787);
const youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ytdlpJsRuntime = process.env.YTDLP_JS_RUNTIME || 'deno';
const ytdlpRemoteComponents = process.env.YTDLP_REMOTE_COMPONENTS || 'ejs:github';
const ytdlpCookiesFile = process.env.YTDLP_COOKIES_FILE || '';
const ytdlpCookiesBase64 = process.env.YTDLP_COOKIES_BASE64 || '';
const ytdlpCookies = process.env.YTDLP_COOKIES || '';
const corsOrigin = process.env.CORS_ORIGIN || true;
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET || '';
const r2PublicBaseUrl = normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL || '');
const cloudUploadLimit = process.env.CLOUD_UPLOAD_LIMIT || '80mb';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const downloadDir = path.resolve(
  process.cwd(),
  process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '.flowify-downloads'),
);
const streamDir = path.join(downloadDir, 'streams');
const runtimeDir = path.join(downloadDir, 'runtime');
const staticDir = path.resolve(
  process.cwd(),
  process.env.STATIC_DIR || path.join(__dirname, '..', '..', 'web', 'dist'),
);

const streamBuilds = new Map();
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
let r2ClientInstance = null;

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: corsOrigin === 'true' ? true : corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'X-File-Name', 'X-YouTube-Api-Key'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  }),
);

app.get('/health', async (req, res) => {
  const ytdlpReady = await hasYtdlp();
  const ffmpegReady = await hasFfmpeg();
  const cookiesReady = Boolean(await resolveCookiesFile());
  res.json({
    ok: true,
    youtubeConfigured: Boolean(getYoutubeApiKey(req)),
    ytdlpAvailable: ytdlpReady && ffmpegReady,
    ffmpegAvailable: ffmpegReady,
    cookiesConfigured: cookiesReady,
    jsRuntime: ytdlpJsRuntime,
    remoteComponents: ytdlpRemoteComponents,
    cloudStorageAvailable: hasR2Config(),
    cloudPublicBaseUrl: Boolean(r2PublicBaseUrl),
  });
});

app.get('/api/search', async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim();
    const pageToken = String(req.query.pageToken || '').trim();
    const maxResults = clamp(Number(req.query.maxResults || 24), 1, 50);

    if (!query) throw httpError(400, 'Missing search query');

    const search = await youtubeFetch(req, '/search', {
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10',
      maxResults: String(maxResults),
      pageToken,
      order: 'relevance',
    });

    const ids = search.items
      .map((item) => item?.id?.videoId)
      .filter(Boolean);
    const details = await getVideoDetails(req, ids);

    res.json({
      tracks: search.items
        .map((item) => {
          const videoId = item?.id?.videoId;
          if (!videoId) return null;
          return trackFromSnippet(videoId, item.snippet, details.get(videoId));
        })
        .filter(Boolean),
      nextPageToken: search.nextPageToken || '',
      totalResults: search.pageInfo?.totalResults || 0,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/trending', async (req, res, next) => {
  try {
    const regionCode = String(req.query.regionCode || 'FR').slice(0, 2);
    const maxResults = clamp(Number(req.query.maxResults || 24), 1, 50);
    const data = await youtubeFetch(req, '/videos', {
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      videoCategoryId: '10',
      regionCode,
      maxResults: String(maxResults),
    });

    res.json({
      tracks: data.items.map((item) => trackFromVideo(item)),
      nextPageToken: '',
      totalResults: data.items.length,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/resolve', async (req, res, next) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) throw httpError(400, 'Missing YouTube URL');

    const { videoId, playlistId } = parseYouTubeUrl(rawUrl);
    if (playlistId && !videoId) {
      res.json(await getPlaylistTracks(req, playlistId));
      return;
    }
    if (videoId) {
      const details = await getVideoDetails(req, [videoId]);
      const item = details.get(videoId);
      if (!item) throw httpError(404, 'Video not found');
      res.json({ tracks: [trackFromVideo(item)], nextPageToken: '', totalResults: 1 });
      return;
    }
    throw httpError(400, 'Unsupported YouTube URL');
  } catch (err) {
    next(err);
  }
});

app.get('/api/stream/:videoId', async (req, res, next) => {
  try {
    const videoId = ensureVideoId(req.params.videoId);
    const remoteUrl = await getAudioStreamUrl(videoId);
    streamLiveMp3(remoteUrl, req, res, next);
  } catch (err) {
    next(err);
  }
});

app.post('/api/cloud/upload', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: cloudUploadLimit }), async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'Fichier audio manquant');

    const contentType = normalizeContentType(req.headers['content-type']);
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw httpError(415, 'Seuls les fichiers audio sont acceptes');
    }

    const originalName = cleanFileName(decodeHeaderValue(String(req.headers['x-file-name'] || 'flowify-track')));
    const key = `cloud/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${originalName}`;

    await getR2Client().send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Body: req.body,
      ContentType: contentType,
      Metadata: {
        originalName,
      },
    }));

    res.json({
      key,
      fileName: originalName,
      contentType,
      sizeBytes: req.body.length,
      url: publicR2Url(key),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/cloud/stream', async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
    const key = ensureCloudKey(String(req.query.key || ''));
    const object = await getR2Client().send(new GetObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Range: req.headers.range,
    }));

    res.status(object.ContentRange ? 206 : 200);
    if (object.ContentType) res.setHeader('Content-Type', object.ContentType);
    else res.type('audio/mpeg');
    if (object.ContentLength !== undefined) res.setHeader('Content-Length', String(object.ContentLength));
    if (object.ContentRange) res.setHeader('Content-Range', object.ContentRange);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (!object.Body) {
      res.end();
      return;
    }
    if (typeof object.Body.pipe === 'function') {
      object.Body.pipe(res);
      return;
    }
    Readable.fromWeb(object.Body.transformToWebStream()).pipe(res);
  } catch (err) {
    next(err);
  }
});

app.post('/api/download/:videoId', async (req, res, next) => {
  try {
    const videoId = ensureVideoId(req.params.videoId);
    await fs.mkdir(downloadDir, { recursive: true });
    const existing = await findDownloadedFile(videoId);
    if (existing) {
      res.json({ videoId, filename: existing, url: `/downloads/${encodeURIComponent(existing)}` });
      return;
    }

    const output = path.join(downloadDir, `${videoId}.%(ext)s`);
    await runYtdlp(await withYtdlpEnvironment([
      '--no-playlist',
      '--format',
      'bestaudio/best',
      '--output',
      output,
      youtubeWatchUrl(videoId),
    ]), 10 * 60 * 1000);

    const filename = await findDownloadedFile(videoId);
    if (!filename) throw httpError(500, 'Download finished but no file was produced');
    res.json({ videoId, filename, url: `/downloads/${encodeURIComponent(filename)}` });
  } catch (err) {
    next(err);
  }
});

app.use('/downloads', express.static(downloadDir, {
  fallthrough: false,
  immutable: true,
  maxAge: '7d',
}));

app.use(express.static(staticDir, {
  immutable: true,
  index: false,
  maxAge: '1h',
}));

app.get('*', async (_req, res, next) => {
  const indexPath = path.join(staticDir, 'index.html');
  try {
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch {
    next();
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Unexpected API error',
    status,
  });
});

app.listen(port, () => {
  console.log(`Flowify API listening on http://localhost:${port}`);
});

async function youtubeFetch(req, endpoint, params) {
  const activeYoutubeApiKey = getYoutubeApiKey(req);
  if (!activeYoutubeApiKey) {
    throw httpError(400, 'Cle YouTube Data API v3 manquante');
  }
  const url = new URL(`https://www.googleapis.com/youtube/v3${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  url.searchParams.set('key', activeYoutubeApiKey);

  const response = await fetch(url);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || `YouTube API HTTP ${response.status}`;
    throw httpError(response.status, message);
  }
  return data;
}

async function getVideoDetails(req, ids) {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  if (!cleanIds.length) return new Map();
  const data = await youtubeFetch(req, '/videos', {
    part: 'snippet,contentDetails,statistics',
    id: cleanIds.join(','),
  });
  return new Map(data.items.map((item) => [item.id, item]));
}

async function getPlaylistTracks(req, playlistId) {
  const data = await youtubeFetch(req, '/playlistItems', {
    part: 'snippet',
    playlistId,
    maxResults: '50',
  });
  const ids = data.items
    .map((item) => item?.snippet?.resourceId?.videoId)
    .filter(Boolean);
  const details = await getVideoDetails(req, ids);
  return {
    tracks: ids
      .map((id) => details.get(id))
      .filter(Boolean)
      .map((item) => trackFromVideo(item)),
    nextPageToken: data.nextPageToken || '',
    totalResults: ids.length,
  };
}

async function ensurePlayableAudioFile(videoId) {
  const existing = await findStreamFile(videoId);
  if (existing) return existing;

  if (!streamBuilds.has(videoId)) {
    streamBuilds.set(videoId, buildPlayableAudioFile(videoId).finally(() => {
      streamBuilds.delete(videoId);
    }));
  }
  return streamBuilds.get(videoId);
}

async function buildPlayableAudioFile(videoId) {
  await fs.mkdir(streamDir, { recursive: true });
  const finalPath = path.join(streamDir, `${videoId}.mp3`);
  const tempPath = path.join(streamDir, `${videoId}.part.mp3`);
  const remoteUrl = await getAudioStreamUrl(videoId);

  await fs.rm(tempPath, { force: true }).catch(() => undefined);
  await runProcess(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-user_agent',
    'Flowify/0.1',
    '-i',
    remoteUrl,
    '-vn',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '160k',
    '-f',
    'mp3',
    tempPath,
  ], 10 * 60 * 1000);
  await fs.rename(tempPath, finalPath);

  const audioPath = await findStreamFile(videoId);
  if (!audioPath) throw httpError(500, 'yt-dlp finished but no playable MP3 was produced');
  return audioPath;
}

async function getAudioStreamUrl(videoId) {
  const { stdout } = await runYtdlp(await withYtdlpEnvironment([
    '--no-playlist',
    '--format',
    'bestaudio/best',
    '--get-url',
    youtubeWatchUrl(videoId),
  ]), 45_000);

  const streamUrl = stdout.split(/\r?\n/).find((line) => line.startsWith('http'));
  if (!streamUrl) throw httpError(502, 'yt-dlp did not return an audio URL');
  return streamUrl;
}

function streamLiveMp3(remoteUrl, req, res, next) {
  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.flushHeaders?.();

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-user_agent',
    'Flowify/0.1',
    '-i',
    remoteUrl,
    '-vn',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '160k',
    '-f',
    'mp3',
    'pipe:1',
  ], { windowsHide: true });

  let stderr = '';
  let closedByClient = false;

  req.on('close', () => {
    closedByClient = true;
    ffmpeg.kill('SIGTERM');
  });

  ffmpeg.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  ffmpeg.on('error', (error) => {
    if (!res.headersSent) next(httpError(500, `ffmpeg failed to start: ${error.message}`));
    else res.destroy(error);
  });

  ffmpeg.on('close', (code) => {
    if (closedByClient) return;
    if (code !== 0) {
      const error = httpError(502, `ffmpeg exited with code ${code}: ${stderr}`);
      if (!res.headersSent) next(error);
      else res.destroy(error);
      return;
    }
    res.end();
  });

  ffmpeg.stdout.pipe(res);
}

async function findStreamFile(videoId) {
  const preferred = path.join(streamDir, `${videoId}.mp3`);
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    return '';
  }
}

async function withYtdlpEnvironment(args) {
  const finalArgs = ['--no-cache-dir'];
  if (ytdlpJsRuntime) {
    finalArgs.push('--js-runtimes', ytdlpJsRuntime);
  }
  if (ytdlpRemoteComponents) {
    finalArgs.push('--remote-components', ytdlpRemoteComponents);
  }

  const cookiesPath = await resolveCookiesFile();
  if (cookiesPath) {
    finalArgs.push('--cookies', cookiesPath);
  }

  return [...finalArgs, ...args];
}

async function resolveCookiesFile() {
  if (ytdlpCookiesFile) {
    try {
      await fs.access(ytdlpCookiesFile);
      return ytdlpCookiesFile;
    } catch {
      return '';
    }
  }

  const cookiesContent = cookiesFromEnvironment();
  if (!cookiesContent) return '';

  await fs.mkdir(runtimeDir, { recursive: true });
  const cookiesPath = path.join(runtimeDir, 'youtube-cookies.txt');
  await fs.writeFile(cookiesPath, cookiesContent, { mode: 0o600 });
  return cookiesPath;
}

function cookiesFromEnvironment() {
  if (ytdlpCookiesBase64) {
    try {
      return Buffer.from(ytdlpCookiesBase64, 'base64').toString('utf8').trim();
    } catch {
      return '';
    }
  }
  return ytdlpCookies.trim();
}

function hasR2Config() {
  return Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2Bucket);
}

function getR2Client() {
  if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
  if (!r2ClientInstance) {
    r2ClientInstance = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });
  }
  return r2ClientInstance;
}

function publicR2Url(key) {
  if (!r2PublicBaseUrl) return '';
  return `${r2PublicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function ensureCloudKey(value) {
  const key = value.trim();
  if (!key || !key.startsWith('cloud/') || key.includes('..')) {
    throw httpError(400, 'Cle cloud invalide');
  }
  return key;
}

function normalizeContentType(value) {
  return String(value || 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function cleanFileName(value) {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 96);
  return cleaned || `flowify-${Date.now()}.mp3`;
}

function decodeHeaderValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function runYtdlp(args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(httpError(504, 'yt-dlp timed out'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(httpError(500, `yt-dlp failed to start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(httpError(502, `yt-dlp exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function hasYtdlp() {
  try {
    await runYtdlp(['--version'], 10_000);
    return true;
  } catch {
    return false;
  }
}

async function hasFfmpeg() {
  try {
    await runProcess(ffmpegPath, ['-version'], 10_000);
    return true;
  } catch {
    return false;
  }
}

function runProcess(command, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(httpError(504, `${command} timed out`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(httpError(500, `${command} failed to start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(httpError(502, `${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function findDownloadedFile(videoId) {
  try {
    const entries = await fs.readdir(downloadDir);
    return entries.find((entry) => entry.startsWith(`${videoId}.`) && !entry.endsWith('.part')) || '';
  } catch {
    return '';
  }
}

function parseYouTubeUrl(rawUrl) {
  const videoMatch = rawUrl.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  const playlistMatch = rawUrl.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return {
    videoId: videoMatch?.[1] || '',
    playlistId: playlistMatch?.[1] || '',
  };
}

function trackFromSnippet(id, snippet, details) {
  return {
    id,
    title: decodeText(snippet?.title || 'Titre inconnu'),
    channel: decodeText(snippet?.channelTitle || ''),
    thumbnail: bestThumbnail(snippet?.thumbnails),
    duration: details?.contentDetails?.duration ? parseDuration(details.contentDetails.duration) : '',
    viewCount: details?.statistics?.viewCount || '',
    publishedAt: snippet?.publishedAt || '',
    description: decodeText(snippet?.description || ''),
  };
}

function trackFromVideo(item) {
  return trackFromSnippet(item.id, item.snippet, item);
}

function bestThumbnail(thumbnails = {}) {
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ''
  );
}

function parseDuration(iso) {
  const match = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function decodeText(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getYoutubeApiKey(req) {
  return String(req.get('X-YouTube-Api-Key') || youtubeApiKey).trim();
}

function ensureVideoId(videoId) {
  if (!videoIdPattern.test(videoId)) throw httpError(400, 'Invalid YouTube video id');
  return videoId;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
