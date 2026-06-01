# Deploiement Flowify

## PWA

Le PWA est publie par GitHub Pages avec `.github/workflows/pages.yml`. Le workflow utilise Node 22.

Ajoute une variable GitHub Actions :

```text
FLOWIFY_API_URL=https://ton-api.example.com
```

Le workflow calcule automatiquement le `base path` pour que l'app marche sur :

```text
https://ton-pseudo.github.io/nom-du-repo/
```

## API yt-dlp

L'API doit tourner sur un service serveur. Elle a besoin de :

```text
YTDLP_PATH
CORS_ORIGIN
```

`YOUTUBE_API_KEY` est optionnelle : elle peut etre renseignee dans l'app, onglet `Parametres`.

Avec Docker, l'image installe `yt-dlp` via `pip`.

## Android APK

Le dossier `android/` est un projet Capacitor. Capacitor 8 demande Node 22 ou plus.

Build local Windows :

```bash
npm run android:apk:windows
```

Build GitHub :

```text
.github/workflows/android.yml
```

L'APK debug est publie comme artifact `Flowify-debug-apk`.

## Supabase

Execute `supabase/schema.sql`, puis verifie :

- Auth email/password active.
- Les politiques RLS sont activees.
- Les utilisateurs peuvent inserer dans `saved_tracks`.
- Supabase Realtime est actif pour `playlists`, `playlist_members` et `playlist_tracks`.
