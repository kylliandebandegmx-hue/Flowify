# Flowify

Flowify est une application musique PWA + APK Android.

Dans l'app, l'utilisateur doit seulement renseigner sa cle YouTube Data API v3 dans `Parametres`. Les tendances et recherches YouTube apparaissent ensuite directement.

## Important

La recherche utilise YouTube Data API v3 directement depuis l'app. La lecture et le telechargement passent uniquement par `yt-dlp` dans `apps/api`.
Pour que l'audio fonctionne sur le PWA GitHub Pages ou l'APK, `apps/api` doit etre disponible sur une URL HTTPS. L'URL Render actuelle est deja preconfiguree dans `apps/web/public/flowify-config.json`: `https://flowify-api.onrender.com`.
Tu peux aussi modifier cette URL dans `Parametres` avec le champ `URL API Flowify yt-dlp`, ou dans la variable GitHub `FLOWIFY_API_URL`.
Le `Dockerfile` a la racine build le PWA et lance l'API Flowify avec `yt-dlp`; si tu deploies cette image, le PWA et l'audio peuvent tourner sur la meme URL.

## Supabase

Execute `supabase/schema.sql` dans le SQL editor Supabase. Le schema gere les comptes, titres sauvegardes, playlists, membres, codes d'invitation et Realtime.

Si ta base existe deja et affiche une erreur `invite_code` ou `joined_at`, execute `supabase/fix-existing-database.sql` dans le SQL editor Supabase.

## GitHub

Les workflows utilisent Node 22 :

- `.github/workflows/pages.yml` publie le PWA sur GitHub Pages.
- `.github/workflows/android.yml` genere l'APK debug et autorise `android/gradlew` avant la compilation.
- `.github/workflows/check.yml` lance les checks.

## URL API Flowify yt-dlp

Cette URL est creee quand tu deploies le serveur Docker Flowify. Le fichier `render.yaml` permet de le faire sur Render depuis GitHub :

1. Upload/push ce repo sur GitHub.
2. Va sur Render, puis `New` > `Blueprint`.
3. Connecte le repo `Flowify`.
4. Render detecte `render.yaml` et cree le service `flowify-api`.
5. Quand le deploy est fini, copie l'URL Render du type `https://flowify-api-xxxx.onrender.com`.
6. Colle cette URL dans Flowify > `Parametres` > `URL API Flowify yt-dlp`.

Tu peux aussi mettre cette meme URL dans la variable GitHub `FLOWIFY_API_URL` pour que le PWA GitHub Pages et l'APK soient preconfigures au build.

## APK

Build local Windows :

```bash
npm run android:apk:windows
```

APK local :

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
