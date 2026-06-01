# Flowify

Flowify est une application musique PWA + APK Android.

Dans l'app, l'utilisateur doit seulement renseigner sa cle YouTube Data API v3 dans `Parametres`. Les tendances et recherches YouTube apparaissent ensuite directement.

## Important

La recherche utilise YouTube Data API v3 directement depuis l'app. La lecture et le telechargement via `yt-dlp` restent dans `apps/api`; si ce service n'est pas disponible sur le PWA public, l'app bascule sur un lecteur YouTube integre au lieu d'afficher une erreur.

## Supabase

Execute `supabase/schema.sql` dans le SQL editor Supabase. Le schema gere les comptes, titres sauvegardes, playlists, membres, codes d'invitation et Realtime.

## GitHub

Les workflows utilisent Node 22 :

- `.github/workflows/pages.yml` publie le PWA sur GitHub Pages.
- `.github/workflows/android.yml` genere l'APK debug et autorise `android/gradlew` avant la compilation.
- `.github/workflows/check.yml` lance les checks.

## APK

Build local Windows :

```bash
npm run android:apk:windows
```

APK local :

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
