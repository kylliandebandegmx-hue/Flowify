FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl unzip \
  && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
  && python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/dist ./apps/web/dist

RUN npm ci --omit=dev --workspace apps/api

COPY apps/api ./apps/api

ENV PORT=8787
ENV YTDLP_PATH=yt-dlp
ENV FFMPEG_PATH=ffmpeg
ENV YTDLP_JS_RUNTIME=deno
ENV YTDLP_REMOTE_COMPONENTS=ejs:github
ENV STATIC_DIR=/app/apps/web/dist

EXPOSE 8787

CMD ["npm", "run", "start:api"]
