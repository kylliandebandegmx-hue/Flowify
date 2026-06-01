# Flowify

Flowify est une application musique PWA + APK Android.

Dans l'app, l'utilisateur doit seulement renseigner sa cle YouTube Data API v3 dans `Parametres`. Les tendances et recherches YouTube apparaissent ensuite directement.

## Important

La recherche utilise YouTube Data API v3 directement depuis l'app. La lecture et le telechargement passent uniquement par `yt-dlp` dans `apps/api`.
Pour que l'audio fonctionne sur le PWA GitHub Pages ou l'APK, `apps/api` doit etre disponible sur une URL HTTPS et renseignee dans la variable GitHub `FLOWIFY_API_URL`.
Le `Dockerfile` a la racine build le PWA et lance l'API Flowify avec `yt-dlp`; si tu deploies cette image, le PWA et l'audio peuvent tourner sur la meme URL.

## Supabase

Execute `supabase/schema.sql` dans le SQL editor Supabase. Le schema gere les comptes, titres sauvegardes, playlists, membres, codes d'invitation et Realtime.

Si ta base existe deja et affiche une erreur `invite_code` ou `joined_at`, execute `supabase/fix-existing-database.sql` dans le SQL editor Supabase.

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
