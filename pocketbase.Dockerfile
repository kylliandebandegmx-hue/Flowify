FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 https://github.com/pocketbase/pocketbase.git .
RUN go build -o /app/pocketbase .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/pocketbase ./pocketbase
RUN mkdir -p /app/pb_data

ENV PORT=8090
EXPOSE 8090
CMD ["./pocketbase", "serve", "--http=0.0.0.0:${PORT}", "--dir", "/app/pb_data"]
