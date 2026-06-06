FROM pocketbase/pocketbase:latest

WORKDIR /app
RUN mkdir -p /app/pb_data

ENV PORT=8090
EXPOSE 8090

CMD sh -lc './pocketbase serve --http=0.0.0.0:${PORT} --dir /app/pb_data'
