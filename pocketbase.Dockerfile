FROM ghcr.io/pocketbase/pocketbase:latest

WORKDIR /app
RUN mkdir -p /app/pb_data

EXPOSE 8090

CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090", "--dir", "/app/pb_data"]
