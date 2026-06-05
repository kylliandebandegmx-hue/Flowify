FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
  && python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/api/package*.json ./
RUN npm install --omit=dev

COPY apps/api/src ./src

ENV PORT=8787
ENV YTDLP_PATH=yt-dlp

EXPOSE 8787
CMD ["npm", "start"]
