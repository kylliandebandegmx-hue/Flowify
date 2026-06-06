FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 https://github.com/pocketbase/pocketbase.git .
RUN set -eux; \
	if [ "${TARGETARCH:-amd64}" = "arm64" ] || [ "${TARGETARCH:-amd64}" = "aarch64" ]; then GOARCH=arm64; else GOARCH=amd64; fi; \
	CGO_ENABLED=0 GOOS=linux GOARCH="$GOARCH" go build -ldflags "-s -w" -o /app/pocketbase .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/pocketbase ./pocketbase
RUN mkdir -p /app/pb_data
RUN chmod +x ./pocketbase

ENV PORT=8090
EXPOSE 8090
CMD sh -lc './pocketbase serve --http=0.0.0.0:${PORT} --dir /app/pb_data'
