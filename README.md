# Flowify

Flowify est une application musique PWA + APK Android.

Elle utilise Supabase pour les comptes/playlists, YouTube Data API v3 pour la recherche, `yt-dlp` cote API pour l'audio, GitHub Pages pour le PWA et GitHub Actions pour l'APK.

## Configuration Dans L'app

Dans Flowify, ouvre `Parametres`, puis remplis :

- `URL API Flowify` : l'URL publique de ton API Node/Express.
- `Cle YouTube Data API v3` : ta cle Google/YouTube.

La cle YouTube est sauvegardee sur l'appareil et envoyee uniquement a ton API Flowify avec le header `X-YouTube-Api-Key`.

## Supabase

Execute `supabase/schema.sql` dans le SQL editor Supabase. Le schema cree les playlists, les membres, les codes d'invitation, la fonction pour rejoindre par code et la synchronisation Realtime.

## GitHub

Les workflows utilisent Node 22 :

- `.github/workflows/pages.yml` publie le PWA sur GitHub Pages.
- `.github/workflows/android.yml` genere l'APK debug.
- `.github/workflows/check.yml` lance les checks.

APK local :

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Build local Windows :

```bash
npm run android:apk:windows
```

## Verification

```bash
npm run check
npm run build:web
npm run android:apk:windows
npm audit
```
