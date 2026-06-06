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

## PocketBase

Deploy PocketBase et configurez l'URL publique dans `VITE_POCKETBASE_URL`.

- Créez les collections `profiles`, `playlists`, `playlist_members`, `playlist_tracks`, `cloud_tracks` et `saved_tracks`.
- PocketBase remplace Supabase pour l'authentification et les metadonnees.
- Les playlists et les membres sont synchronisés via le service PocketBase.

Si vous voulez automatiser les backups, copiez régulièrement le fichier `pb_data/pocketbase.db` dans Cloudflare R2.

## Cle YouTube

La cle YouTube Data API v3 se renseigne directement dans l'app, onglet `Parametres`.

## yt-dlp

`yt-dlp` reste dans `apps/api`. En local, lance `npm run dev:api` pour que le web utilise automatiquement `http://localhost:8787`.

Pour le PWA GitHub Pages ou l'APK construit par GitHub, GitHub ne peut pas executer `yt-dlp` en permanence. Il faut deployer `apps/api` sur un hebergeur Node/Docker, puis ajouter son adresse HTTPS dans la variable GitHub `FLOWIFY_API_URL`; il n'y a rien a saisir dans l'app. Sans ce service, la lecture audio est volontairement bloquee car Flowify utilise uniquement `yt-dlp`.

Le `Dockerfile` a la racine sert aussi `apps/web/dist`. Avec ce mode, une seule URL peut servir l'app et l'API: Flowify detecte automatiquement `/health` sur la meme origine.
