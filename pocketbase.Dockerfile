FROM alpine:3.22 AS builder
ARG TARGETARCH

# install curl and unzip to fetch prebuilt PocketBase release
RUN apk add --no-cache curl unzip ca-certificates

WORKDIR /tmp
# Determine latest tag and download matching prebuilt binary
RUN set -eux; \
	TAG_URL=$(curl -sI -o /dev/null -w '%{url_effective}' https://github.com/pocketbase/pocketbase/releases/latest); \
	TAG=${TAG_URL##*/}; \
	TAG_NO_V=${TAG#v}; \
	if [ "${TARGETARCH:-amd64}" = "arm64" ] || [ "${TARGETARCH:-amd64}" = "aarch64" ]; then ARCH=arm64; else ARCH=amd64; fi; \
	ASSET_NAME="pocketbase_${TAG_NO_V}_linux_${ARCH}.zip"; \
	DOWNLOAD_URL="https://github.com/pocketbase/pocketbase/releases/download/${TAG}/${ASSET_NAME}"; \
	echo "Downloading ${DOWNLOAD_URL}"; \
	curl -L -o /tmp/pocketbase.zip "${DOWNLOAD_URL}"; \
	unzip /tmp/pocketbase.zip -d /app; \
	chmod +x /app/pocketbase; \
	ls -lh /app/pocketbase

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/pocketbase ./pocketbase
RUN mkdir -p /app/pb_data
RUN chmod +x ./pocketbase

ENV PORT=8090
EXPOSE 8090
CMD sh -lc './pocketbase serve --http=0.0.0.0:${PORT} --dir /app/pb_data'
