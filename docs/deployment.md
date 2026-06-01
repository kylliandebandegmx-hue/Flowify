# Deploiement Flowify

## PWA

Le PWA est publie par GitHub Pages avec `.github/workflows/pages.yml`. Le workflow utilise Node 22.

Dans GitHub :

```text
Settings > Pages > Source: GitHub Actions
```

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
- Supabase Realtime est actif pour `playlists`, `playlist_members` et `playlist_tracks`.

Si la base existait deja avant les playlists partagees, execute aussi `supabase/fix-existing-database.sql`.

## Cle YouTube

La cle YouTube Data API v3 se renseigne directement dans l'app, onglet `Parametres`.

## yt-dlp

`yt-dlp` reste dans `apps/api`. En local, lance `npm run dev:api` pour que le web utilise automatiquement `http://localhost:8787`.

Pour le PWA GitHub Pages ou l'APK construit par GitHub, GitHub ne peut pas executer `yt-dlp` en permanence. Il faut deployer `apps/api` sur un hebergeur Node/Docker, puis ajouter son adresse HTTPS dans la variable GitHub `FLOWIFY_API_URL`; il n'y a rien a saisir dans l'app. Sans ce service, la lecture audio est volontairement bloquee car Flowify utilise uniquement `yt-dlp`.
