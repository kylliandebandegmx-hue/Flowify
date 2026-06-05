import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const app = express();
const port = Number(process.env.PORT || 8787);
const youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const ytdlpJsRuntime = process.env.YTDLP_JS_RUNTIME || 'deno';
const ytdlpRemoteComponents = process.env.YTDLP_REMOTE_COMPONENTS || 'ejs:github';
const ytdlpCookiesFile = process.env.YTDLP_COOKIES_FILE || '';
const ytdlpCookiesBase64 = process.env.YTDLP_COOKIES_BASE64 || '';
const ytdlpCookies = process.env.YTDLP_COOKIES || '';
const corsOrigin = process.env.CORS_ORIGIN || true;
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = normalizeR2BucketName(process.env.R2_BUCKET || '');
const r2Endpoint = normalizeBaseUrl(process.env.R2_ENDPOINT || '');
const r2PublicBaseUrl = normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL || '');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const downloadDir = path.resolve(
  process.cwd(),
  process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '.flowify-downloads'),
);
const streamDir = path.join(downloadDir, 'streams');
const cloudQueueDir = path.join(downloadDir, 'cloud-queues');
const runtimeDir = path.join(downloadDir, 'runtime');
const staticDir = path.resolve(
  process.cwd(),
  process.env.STATIC_DIR || path.join(__dirname, '..', '..', 'web', 'dist'),
);

const streamBuilds = new Map();
const cloudQueueStreams = new Map();
const cloudQueueBuilds = new Map();
const cloudQueueStreamTtlMs = 2 * 60 * 60 * 1000;
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
    cloudBucketConfigured: Boolean(r2Bucket),
    cloudBucketValid: isValidR2BucketName(r2Bucket),
    cloudBucketName: r2Bucket,
    cloudEndpointConfigured: Boolean(getR2Endpoint()),
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

app.post('/api/cloud/upload', async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');

    const contentType = normalizeContentType(req.headers['content-type']);
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw httpError(415, 'Seuls les fichiers audio sont acceptes');
    }

    const originalName = cleanFileName(decodeHeaderValue(String(req.headers['x-file-name'] || 'flowify-track')));
    const key = `cloud/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${originalName}`;
    const contentLength = parseContentLength(req.headers['content-length']);
    let uploadedBytes = 0;

    const body = req.pipe(new Transform({
      transform(chunk, _encoding, callback) {
        uploadedBytes += chunk.length;
        callback(null, chunk);
      },
    }));

    const command = {
      Bucket: r2Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: {
        originalName,
      },
    };
    if (contentLength) {
      command.ContentLength = contentLength;
    }

    await getR2Client().send(new PutObjectCommand(command));

    if (!uploadedBytes) throw httpError(400, 'Fichier audio manquant');

    res.json({
      key,
      fileName: originalName,
      contentType,
      sizeBytes: uploadedBytes,
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

app.get('/api/cloud/signed-url', async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
    const key = ensureCloudKey(String(req.query.key || ''));
    const expiresIn = clamp(Number(req.query.expiresIn || 3600), 60, 3600);
    const url = await getSignedUrl(getR2Client(), new GetObjectCommand({
      Bucket: r2Bucket,
      Key: key,
    }), { expiresIn });

    res.json({
      key,
      url,
      expiresIn,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/cloud/queue-streams', async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
    const tracks = normalizeCloudQueue(req.body?.tracks);
    const id = cloudQueueId(tracks);
    const segments = cloudQueueSegments(tracks);
    const duration = segments[segments.length - 1]?.end || 0;
    cleanupCloudQueueStreams();
    cloudQueueStreams.set(id, {
      createdAt: Date.now(),
      duration,
      segments,
      tracks,
    });
    res.json({
      id,
      duration,
      segments,
      url: `/api/cloud/queue-streams/${encodeURIComponent(id)}`,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/cloud/queue-streams/:id', async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
    cleanupCloudQueueStreams();
    const id = ensureCloudQueueId(String(req.params.id || ''));
    let queue = cloudQueueStreams.get(id);
    if (!queue) {
      queue = await readCloudQueueMeta(id);
    }
    if (!queue) throw httpError(404, 'File audio Cloud expiree. Relance la playlist.');
    if (!Array.isArray(queue.tracks) || !queue.tracks.length) {
      if (queue.filePath) {
        await sendAudioFile(queue.filePath, req, res, 'audio/mpeg');
        return;
      }
      throw httpError(404, 'File audio Cloud expiree. Relance la playlist.');
    }

    await streamCloudQueue(queue.tracks, req, res, {
      startIndex: clamp(Number(req.query.startIndex || 0), 0, queue.tracks.length - 1),
      startOffset: clampSeconds(Number(req.query.offset || 0), 0, 24 * 60 * 60),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/cloud/delete', async (req, res, next) => {
  try {
    if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
    const key = ensureCloudKey(String(req.body?.key || ''));
    await getR2Client().send(new DeleteObjectCommand({
      Bucket: r2Bucket,
      Key: key,
    }));
    res.json({ ok: true, key });
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

  // Auto-ping toutes les 14 minutes pour éviter le cold start Render (veille après 15 min)
  const selfPingUrl = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : null;

  if (selfPingUrl) {
    const PING_INTERVAL_MS = 14 * 60 * 1000;
    setInterval(async () => {
      try {
        const response = await fetch(selfPingUrl, { signal: AbortSignal.timeout(10_000) });
        console.log(`[keepalive] ping ${selfPingUrl} → ${response.status}`);
      } catch (err) {
        console.warn(`[keepalive] ping failed: ${err?.message || err}`);
      }
    }, PING_INTERVAL_MS);
    console.log(`[keepalive] auto-ping activé → ${selfPingUrl}`);
  }
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
  return Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey && isValidR2BucketName(r2Bucket));
}

function getR2Client() {
  if (!isValidR2BucketName(r2Bucket)) {
    throw httpError(400, 'R2_BUCKET invalide: mets uniquement le nom du bucket Cloudflare, par exemple flowify-music.');
  }
  if (!hasR2Config()) throw httpError(503, 'Cloud R2 non configure sur l API Flowify');
  if (!r2ClientInstance) {
    r2ClientInstance = new S3Client({
      region: 'auto',
      endpoint: getR2Endpoint(),
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });
  }
  return r2ClientInstance;
}

function getR2Endpoint() {
  if (r2Endpoint) return r2Endpoint;
  if (!r2AccountId) return '';
  return `https://${r2AccountId}.r2.cloudflarestorage.com`;
}

function publicR2Url(key) {
  if (!r2PublicBaseUrl) return '';
  return `${r2PublicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function normalizeCloudQueue(value) {
  const rawTracks = Array.isArray(value) ? value : [];
  const tracks = rawTracks
    .slice(0, 200)
    .map((track) => ({
      contentType: normalizeContentType(track?.contentType || 'audio/mpeg'),
      durationSeconds: clamp(Number(track?.durationSeconds || 0), 0, 24 * 60 * 60),
      key: ensureCloudKey(String(track?.key || track?.storageKey || '')),
      title: String(track?.title || '').slice(0, 160),
    }));

  if (!tracks.length) throw httpError(400, 'File Cloud vide');
  return tracks;
}

function cleanupCloudQueueStreams() {
  const now = Date.now();
  for (const [id, queue] of cloudQueueStreams.entries()) {
    if (now - queue.createdAt > cloudQueueStreamTtlMs) {
      cloudQueueStreams.delete(id);
    }
  }
}

function cloudQueueId(tracks) {
  return createHash('sha256')
    .update(JSON.stringify(tracks.map((track) => ({
      durationSeconds: Math.round((track.durationSeconds || 0) * 1000) / 1000,
      key: track.key,
    }))))
    .digest('hex')
    .slice(0, 32);
}

function ensureCloudQueueId(value) {
  const id = String(value || '').trim();
  if (!/^[a-f0-9]{32}$/.test(id)) throw httpError(400, 'File audio Cloud invalide');
  return id;
}

function cloudQueueSegments(tracks) {
  let cursor = 0;
  return tracks.map((track, index) => {
    const duration = Math.max(1, track.durationSeconds || 180);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return {
      duration,
      end,
      index,
      key: track.key,
      start,
      title: track.title,
    };
  });
}

async function readCloudQueueMeta(id) {
  const metaPath = path.join(cloudQueueDir, `${ensureCloudQueueId(id)}.json`);
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (!meta?.filePath || !Array.isArray(meta?.segments)) return null;
    await fs.access(meta.filePath);
    return meta;
  } catch {
    return null;
  }
}

async function ensureCloudQueueFile(id, tracks) {
  const existing = await readCloudQueueMeta(id);
  if (existing) return existing;

  if (!cloudQueueBuilds.has(id)) {
    cloudQueueBuilds.set(id, buildCloudQueueFile(id, tracks).finally(() => {
      cloudQueueBuilds.delete(id);
    }));
  }

  return cloudQueueBuilds.get(id);
}

async function buildCloudQueueFile(id, tracks) {
  await fs.mkdir(cloudQueueDir, { recursive: true });
  const finalPath = path.join(cloudQueueDir, `${id}.mp3`);
  const metaPath = path.join(cloudQueueDir, `${id}.json`);
  const tempFinalPath = path.join(cloudQueueDir, `${id}.${randomUUID()}.part.mp3`);
  const buildDir = path.join(cloudQueueDir, `${id}-${randomUUID()}`);
  await fs.mkdir(buildDir, { recursive: true });

  try {
    const segmentPaths = [];
    const segments = [];
    let cursor = 0;

    for (const [index, track] of tracks.entries()) {
      const inputPath = path.join(buildDir, `input-${String(index).padStart(4, '0')}${extensionForContentType(track.contentType)}`);
      const segmentPath = path.join(buildDir, `segment-${String(index).padStart(4, '0')}.mp3`);

      await downloadCloudObjectToFile(track.key, inputPath);
      await runFfmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '160k',
        '-f',
        'mp3',
        segmentPath,
      ], 10 * 60 * 1000);

      const probedDuration = await probeAudioDuration(segmentPath);
      const estimatedDuration = await estimateMp3Duration(segmentPath);
      const duration = Math.max(1, probedDuration || track.durationSeconds || estimatedDuration || 1);
      const start = cursor;
      const end = start + duration;
      segmentPaths.push(segmentPath);
      segments.push({
        duration,
        end,
        index,
        key: track.key,
        start,
        title: track.title,
      });
      cursor = end;
    }

    const concatPath = path.join(buildDir, 'concat.txt');
    await fs.writeFile(
      concatPath,
      segmentPaths.map((filePath) => `file '${escapeFfmpegConcatPath(filePath)}'`).join('\n'),
      'utf8',
    );
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-c',
      'copy',
      tempFinalPath,
    ], 10 * 60 * 1000);
    await fs.rename(tempFinalPath, finalPath);

    const meta = {
      createdAt: Date.now(),
      duration: cursor,
      filePath: finalPath,
      segments,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf8');
    return meta;
  } catch (error) {
    await fs.rm(tempFinalPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(buildDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function downloadCloudObjectToFile(key, filePath) {
  const object = await getR2Client().send(new GetObjectCommand({
    Bucket: r2Bucket,
    Key: key,
  }));
  if (!object.Body) throw httpError(404, 'Fichier Cloud introuvable');
  await pipeline(await cloudBodyToReadable(object.Body), createWriteStream(filePath));
}

function runFfmpeg(args, timeoutMs = 60_000) {
  return runProcess(ffmpegPath, args, timeoutMs, 'ffmpeg');
}

function runFfprobe(args, timeoutMs = 30_000) {
  return runProcess(ffprobePath, args, timeoutMs, 'ffprobe');
}

async function probeAudioDuration(filePath) {
  try {
    const { stdout } = await runFfprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ], 20_000);
    const payload = JSON.parse(stdout);
    const duration = Number(payload?.format?.duration || 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

async function estimateMp3Duration(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size > 0 ? (stat.size * 8) / 160000 : 0;
  } catch {
    return 0;
  }
}

async function sendAudioFile(filePath, req, res, contentType) {
  const stat = await fs.stat(filePath);
  const size = stat.size;
  const range = String(req.headers.range || '');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : size - 1;
    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    end = Math.min(end, size - 1);

    res.status(206);
    res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.status(200);
  res.setHeader('Content-Length', String(size));
  createReadStream(filePath).pipe(res);
}

function extensionForContentType(contentType) {
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return '.mp3';
  if (contentType.includes('mp4') || contentType.includes('aac')) return '.m4a';
  if (contentType.includes('ogg')) return '.ogg';
  if (contentType.includes('flac')) return '.flac';
  if (contentType.includes('wav')) return '.wav';
  return '.audio';
}

function escapeFfmpegConcatPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "\\'");
}

async function streamCloudQueue(tracks, req, res, options = {}) {
  let closedByClient = false;
  req.on('close', () => {
    closedByClient = true;
  });

  const startIndex = Math.min(Math.max(options.startIndex || 0, 0), tracks.length - 1);
  const startOffset = Math.max(0, Number(options.startOffset || 0));
  const activeTracks = tracks.slice(startIndex);
  if (!activeTracks.length) throw httpError(400, 'File Cloud vide');

  const concatPath = path.join(runtimeDir, `cloud-queue-${randomUUID()}.txt`);
  await fs.mkdir(runtimeDir, { recursive: true });
  const signedUrls = await Promise.all(activeTracks.map(async (track) => getSignedUrl(getR2Client(), new GetObjectCommand({
    Bucket: r2Bucket,
    Key: track.key,
  }), { expiresIn: 3600 })));
  const concatLines = signedUrls.flatMap((url, index) => {
    const lines = [`file '${escapeFfmpegConcatPath(url)}'`];
    if (index === 0 && startOffset > 0) {
      lines.push(`inpoint ${startOffset}`);
    }
    return lines;
  });
  await fs.writeFile(concatPath, concatLines.join('\n'), 'utf8');

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
    '-protocol_whitelist',
    'file,http,https,tcp,tls,crypto,httpproxy',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-vn',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '160k',
    '-f',
    'mp3',
    'pipe:1',
  ], { windowsHide: true });

  let stderr = '';
  const cleanup = () => {
    void fs.rm(concatPath, { force: true }).catch(() => undefined);
  };
  const stop = () => {
    closedByClient = true;
    ffmpeg.kill('SIGTERM');
    cleanup();
  };

  req.once('close', stop);
  res.once('close', stop);
  ffmpeg.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  ffmpeg.on('error', (error) => {
    cleanup();
    if (!res.destroyed) res.destroy(error);
  });
  ffmpeg.on('close', (code) => {
    cleanup();
    req.off?.('close', stop);
    res.off?.('close', stop);
    if (closedByClient || res.destroyed || res.writableEnded) return;
    if (code !== 0) {
      res.destroy(httpError(502, `ffmpeg exited with code ${code}: ${stderr}`));
      return;
    }
    res.end();
  });

  ffmpeg.stdout.pipe(res, { end: false });
}

async function transcodeCloudObjectToResponse(body, res) {
  const input = await cloudBodyToReadable(body);
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      'pipe:0',
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
    let settled = false;
    const onResponseClose = () => {
      ffmpeg.kill('SIGTERM');
      finish();
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      res.off?.('close', onResponseClose);
      input.destroy?.();
      if (error) reject(error);
      else resolve();
    };

    input.on?.('error', (error) => {
      ffmpeg.stdin.destroy(error);
    });
    res.once('close', onResponseClose);
    ffmpeg.stdin.on('error', () => undefined);
    ffmpeg.stdout.on('error', (error) => {
      finish(res.destroyed ? undefined : error);
    });
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    ffmpeg.on('error', (error) => {
      finish(httpError(500, `ffmpeg failed to start: ${error.message}`));
    });
    ffmpeg.on('close', (code) => {
      if (res.destroyed || res.writableEnded) {
        finish();
        return;
      }
      if (code !== 0) {
        finish(httpError(502, `ffmpeg exited with code ${code}: ${stderr}`));
        return;
      }
      finish();
    });

    input.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res, { end: false });
  });
}

async function cloudBodyToReadable(body) {
  if (typeof body.pipe === 'function') return body;
  if (typeof body.transformToWebStream === 'function') {
    return Readable.fromWeb(body.transformToWebStream());
  }
  if (typeof body.transformToByteArray === 'function') {
    return Readable.from(Buffer.from(await body.transformToByteArray()));
  }
  return Readable.from([]);
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

function normalizeR2BucketName(value) {
  const clean = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!clean) return '';

  try {
    const url = new URL(clean);
    const pathParts = url.pathname.split('/').filter(Boolean);
    return pathParts.at(-1) || clean;
  } catch {
    return clean.replace(/^s3:\/\//i, '').split('/').filter(Boolean).at(-1) || clean;
  }
}

function isValidR2BucketName(value) {
  const name = String(value || '');
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)
    && !name.includes('..')
    && !name.includes('.-')
    && !name.includes('-.')
    && !/^(\d{1,3}\.){3}\d{1,3}$/.test(name);
}

function parseContentLength(value) {
  const size = Number(value || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
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

function clampSeconds(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
