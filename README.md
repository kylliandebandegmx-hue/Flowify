# Flowify

Flowify est une application musique PWA + APK Android.

Dans l'app, l'utilisateur doit seulement renseigner sa cle YouTube Data API v3 dans `Parametres`. Les tendances et recherches YouTube apparaissent ensuite directement.
L'onglet `YouTube` garde la lecture via `yt-dlp`. L'onglet `Cloud` permet d'uploader tes propres fichiers audio pour les ecouter dans Flowify et les ajouter a une playlist partagee.

## Important

La recherche utilise YouTube Data API v3 directement depuis l'app. La lecture et le telechargement passent uniquement par `yt-dlp` dans `apps/api`. Pour la compatibilite navigateur/mobile, l'API repacke le flux audio en MP3 avec `ffmpeg`.
Pour que l'audio fonctionne sur le PWA GitHub Pages ou l'APK, `apps/api` doit etre disponible sur une URL HTTPS. L'URL Render actuelle est deja preconfiguree dans `apps/web/public/flowify-config.json`: `https://flowify-api.onrender.com`.
Tu peux aussi modifier cette URL dans `Parametres` avec le champ `URL API Flowify yt-dlp`, ou dans la variable GitHub `FLOWIFY_API_URL`.
Le `Dockerfile` a la racine build le PWA et lance l'API Flowify avec `yt-dlp`; si tu deploies cette image, le PWA et l'audio peuvent tourner sur la meme URL.

## Cloud audio

Pour les musiques que tu uploades toi-meme, Flowify utilise Cloudflare R2. R2 est compatible S3, a un free tier de 10 GB-month de stockage par mois, et n'a pas de frais d'egress Internet sur le stockage standard.

1. Cree un bucket R2 dans Cloudflare, par exemple `flowify-music`.
2. Cree des cles API R2 avec acces lecture/ecriture au bucket.
3. Dans Render > `flowify-api` > `Environment`, ajoute :

```env
R2_ACCOUNT_ID=ton_account_id_cloudflare
R2_ACCESS_KEY_ID=ta_cle_r2
R2_SECRET_ACCESS_KEY=ton_secret_r2
R2_BUCKET=flowify-music
R2_PUBLIC_BASE_URL=
CLOUD_UPLOAD_LIMIT=80mb
```

`R2_PUBLIC_BASE_URL` peut rester vide : Flowify passe alors par `/api/cloud/stream`, ce qui evite une configuration CORS R2 en plus.

## Supabase

Execute `supabase/schema.sql` dans le SQL editor Supabase. Le schema gere les comptes, titres sauvegardes, musiques Cloud, playlists, membres, codes d'invitation et Realtime.

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

## Cookies YouTube pour yt-dlp

Sur Render, YouTube peut bloquer l'IP du serveur avec `HTTP Error 429` ou `Sign in to confirm you're not a bot`. Dans ce cas, ajoute des cookies YouTube a Render :

1. Depuis Chrome sur ton PC, exporte les cookies YouTube au format `cookies.txt` Netscape avec une extension d'export de cookies.
2. Convertis le fichier en base64 avec PowerShell :

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\chemin\youtube-cookies.txt")) | Set-Clipboard
```

3. Dans Render > `flowify-api` > `Environment`, ajoute `YTDLP_COOKIES_BASE64`.
4. Colle la valeur base64, sauvegarde, puis redeploie.

L'API indique ensuite `cookiesConfigured: true` sur `/health`. Elle active aussi `YTDLP_REMOTE_COMPONENTS=ejs:github`, necessaire quand YouTube demande un challenge JavaScript.

## APK

Build local Windows :

```bash
npm run android:apk:windows
```

APK local :

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
