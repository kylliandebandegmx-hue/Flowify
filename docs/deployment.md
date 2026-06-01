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

## Cle YouTube

La cle YouTube Data API v3 se renseigne directement dans l'app, onglet `Parametres`.
