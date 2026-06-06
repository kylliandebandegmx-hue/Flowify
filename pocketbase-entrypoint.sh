#!/bin/sh
set -e

if [ -n "$POCKETBASE_ADMIN_EMAIL" ] && [ -n "$POCKETBASE_ADMIN_PASSWORD" ]; then
  echo "PocketBase: creating/updating superuser from environment"
  ./pocketbase --dir /app/pb_data superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD"
fi

exec ./pocketbase serve --http=0.0.0.0:${PORT:-8090} --dir /app/pb_data
