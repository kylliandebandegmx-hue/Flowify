package com.flowify.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

@CapacitorPlugin(name = "FlowifyNativeAudio")
public class FlowifyNativeAudioPlugin extends Plugin {
    private static final String NOTIFICATION_CHANNEL_ID = "flowify_playback";
    private static final int NOTIFICATION_ID = 1001;
    static final String ACTION_NEXT = "com.flowify.app.action.NEXT";
    static final String ACTION_PLAY_PAUSE = "com.flowify.app.action.PLAY_PAUSE";
    static final String ACTION_PREVIOUS = "com.flowify.app.action.PREVIOUS";
    private static FlowifyNativeAudioPlugin activeInstance;

    private static class AudioTrack {
        String artist;
        String id;
        String title;
        String url;
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<AudioTrack> queue = new ArrayList<>();
    private final Random random = new Random();
    private MediaPlayer player;
    private int currentIndex = -1;
    private boolean prepared = false;
    private boolean repeat = false;
    private boolean shuffle = false;
    private float volume = 1f;
    private MediaSession mediaSession;
    private NotificationManager notificationManager;

    @Override
    public void load() {
        activeInstance = this;
    }

    static void handleNotificationAction(String action) {
        FlowifyNativeAudioPlugin instance = activeInstance;
        if (instance == null || action == null) return;
        instance.handler.post(() -> instance.handleMediaAction(action));
    }

    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            updateMediaSessionState();
            notifyState(null);
            if (player != null && player.isPlaying()) {
                handler.postDelayed(this, 1000);
            }
        }
    };

    @PluginMethod
    public void playQueue(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        if (tracks == null || tracks.length() == 0) {
            call.reject("File audio vide.");
            return;
        }

        queue.clear();
        for (int i = 0; i < tracks.length(); i++) {
            try {
                JSONObject item = tracks.getJSONObject(i);
                AudioTrack track = new AudioTrack();
                track.artist = item.optString("artist", "Flowify");
                track.id = item.optString("id", "");
                track.title = item.optString("title", "Titre Flowify");
                track.url = item.optString("url", "");
                if (!track.url.isEmpty()) {
                    queue.add(track);
                }
            } catch (Exception ignored) {
                // Ignore invalid queue entries.
            }
        }

        if (queue.isEmpty()) {
            call.reject("Aucune URL audio native valide.");
            return;
        }

        int startIndex = call.getInt("index", 0);
        volume = clampVolume(call.getDouble("volume", 1.0));
        shuffle = call.getBoolean("shuffle", false);
        repeat = call.getBoolean("repeat", false);
        loadIndex(Math.max(0, Math.min(startIndex, queue.size() - 1)), true);
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        if (player == null && currentIndex >= 0 && currentIndex < queue.size()) {
            loadIndex(currentIndex, true);
            call.resolve();
            return;
        }
        if (player != null && prepared) {
            player.start();
            startProgress();
            updateMediaSessionState();
            showPlaybackNotification();
            notifyState(null);
        }
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (player != null && prepared && player.isPlaying()) {
            player.pause();
        }
        updateMediaSessionState();
        showPlaybackNotification();
        notifyState(null);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        releasePlayer();
        queue.clear();
        currentIndex = -1;
        cancelPlaybackNotification();
        updateMediaSessionState();
        notifyState(null);
        call.resolve();
    }

    @PluginMethod
    public void next(PluginCall call) {
        playNext(false);
        call.resolve();
    }

    @PluginMethod
    public void previous(PluginCall call) {
        if (queue.isEmpty()) {
            call.resolve();
            return;
        }
        int nextIndex = Math.max(0, currentIndex - 1);
        loadIndex(nextIndex, true);
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        if (player != null && prepared) {
            int positionMs = (int) Math.max(0, call.getDouble("position", 0.0) * 1000);
            player.seekTo(positionMs);
            updateMediaSessionState();
            showPlaybackNotification();
            notifyState(null);
        }
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        volume = clampVolume(call.getDouble("volume", 1.0));
        if (player != null) {
            player.setVolume(volume, volume);
        }
        call.resolve();
    }

    @PluginMethod
    public void setModes(PluginCall call) {
        shuffle = call.getBoolean("shuffle", shuffle);
        repeat = call.getBoolean("repeat", repeat);
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildState(null));
    }

    private float clampVolume(double nextVolume) {
        return (float) Math.max(0, Math.min(1, nextVolume));
    }

    private void ensureMediaSession() {
        requestNotificationPermissionIfNeeded();
        if (mediaSession != null) return;
        mediaSession = new MediaSession(getContext(), "Flowify");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                if (player != null && prepared) {
                    player.start();
                    startProgress();
                    updateMediaSessionState();
                    showPlaybackNotification();
                    notifyState(null);
                }
            }

            @Override
            public void onPause() {
                if (player != null && prepared && player.isPlaying()) {
                    player.pause();
                }
                updateMediaSessionState();
                showPlaybackNotification();
                notifyState(null);
            }

            @Override
            public void onSkipToNext() {
                playNext(false);
            }

            @Override
            public void onSkipToPrevious() {
                if (!queue.isEmpty()) {
                    loadIndex(Math.max(0, currentIndex - 1), true);
                }
            }

            @Override
            public void onSeekTo(long pos) {
                if (player != null && prepared) {
                    player.seekTo((int) Math.max(0, pos));
                    updateMediaSessionState();
                    showPlaybackNotification();
                    notifyState(null);
                }
            }
        });
        mediaSession.setActive(true);
        updateMediaSessionState();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getActivity() == null) return;
        Context context = getContext();
        if (context == null) return;
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(
                getActivity(),
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                4101
        );
    }

    private void handleMediaAction(String action) {
        if (ACTION_NEXT.equals(action)) {
            playNext(false);
            return;
        }
        if (ACTION_PREVIOUS.equals(action)) {
            if (!queue.isEmpty()) {
                loadIndex(Math.max(0, currentIndex - 1), true);
            }
            return;
        }
        if (ACTION_PLAY_PAUSE.equals(action)) {
            if (player == null || !prepared) return;
            if (player.isPlaying()) {
                player.pause();
            } else {
                player.start();
                startProgress();
            }
            updateMediaSessionState();
            showPlaybackNotification();
            notifyState(null);
        }
    }

    private void updateMediaSessionMetadata(AudioTrack track) {
        if (mediaSession == null || track == null) return;
        mediaSession.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, track.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, track.artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "Flowify")
                .build());
    }

    private void updateMediaSessionState() {
        if (mediaSession == null) return;
        long actions = PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO;
        int state = PlaybackState.STATE_NONE;
        long position = 0;
        if (player != null) {
            try {
                state = prepared && player.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
                position = prepared ? player.getCurrentPosition() : 0;
            } catch (Exception ignored) {
                state = PlaybackState.STATE_NONE;
            }
        }
        mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(state, position, 1f)
                .build());
    }

    private void showPlaybackNotification() {
        if (currentIndex < 0 || currentIndex >= queue.size() || mediaSession == null) return;
        Context context = getContext();
        if (context == null) return;
        AudioTrack track = queue.get(currentIndex);
        NotificationManager manager = getNotificationManager();
        if (manager == null) return;
        boolean isPlaying = player != null && prepared && player.isPlaying();

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent contentIntent = launchIntent == null
                ? null
                : PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent previousIntent = mediaActionIntent(ACTION_PREVIOUS, 1);
        PendingIntent playPauseIntent = mediaActionIntent(ACTION_PLAY_PAUSE, 2);
        PendingIntent nextIntent = mediaActionIntent(ACTION_NEXT, 3);
        Bitmap largeIcon = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, NOTIFICATION_CHANNEL_ID)
                : new Notification.Builder(context);
        builder
                .setSmallIcon(R.drawable.flowify_icon)
                .setContentTitle(track.title)
                .setContentText(track.artist)
                .setSubText("Flowify")
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .setOngoing(isPlaying)
                .setPriority(Notification.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_previous, "Precedent", previousIntent)
                .addAction(isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, isPlaying ? "Pause" : "Lecture", playPauseIntent)
                .addAction(android.R.drawable.ic_media_next, "Suivant", nextIntent)
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }
        if (contentIntent != null) {
            builder.setContentIntent(contentIntent);
            mediaSession.setSessionActivity(contentIntent);
        }
        manager.notify(NOTIFICATION_ID, builder.build());
    }

    private PendingIntent mediaActionIntent(String action, int requestCode) {
        Context context = getContext();
        Intent intent = new Intent(context, FlowifyMediaButtonReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private NotificationManager getNotificationManager() {
        if (notificationManager != null) return notificationManager;
        Context context = getContext();
        if (context == null) return null;
        notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && notificationManager != null) {
            NotificationChannel channel = new NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Lecture Flowify",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Lecture audio Flowify");
            channel.setShowBadge(false);
            notificationManager.createNotificationChannel(channel);
        }
        return notificationManager;
    }

    private void cancelPlaybackNotification() {
        NotificationManager manager = getNotificationManager();
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }
    }

    private void loadIndex(int index, boolean autoplay) {
        ensureMediaSession();
        releasePlayer();
        currentIndex = index;
        prepared = false;

        AudioTrack track = queue.get(index);
        updateMediaSessionMetadata(track);
        updateMediaSessionState();
        showPlaybackNotification();
        MediaPlayer nextPlayer = new MediaPlayer();
        player = nextPlayer;

        try {
            nextPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build());
            nextPlayer.setWakeMode(getContext(), PowerManager.PARTIAL_WAKE_LOCK);
            nextPlayer.setVolume(volume, volume);
            nextPlayer.setDataSource(track.url);
            nextPlayer.setOnPreparedListener(mediaPlayer -> {
                prepared = true;
                if (autoplay) {
                    mediaPlayer.start();
                    startProgress();
                }
                updateMediaSessionState();
                showPlaybackNotification();
                notifyState(null);
            });
            nextPlayer.setOnCompletionListener(mediaPlayer -> playNext(true));
            nextPlayer.setOnErrorListener((mediaPlayer, what, extra) -> {
                notifyState("Lecture native impossible.");
                playNext(true);
                return true;
            });
            nextPlayer.prepareAsync();
            notifyState(null);
        } catch (Exception error) {
            notifyState(error.getMessage());
            playNext(true);
        }
    }

    private void playNext(boolean fromCompletion) {
        if (queue.isEmpty()) return;
        if (repeat && fromCompletion) {
            loadIndex(currentIndex, true);
            return;
        }

        int nextIndex = currentIndex + 1;
        if (shuffle && queue.size() > 1) {
            do {
                nextIndex = random.nextInt(queue.size());
            } while (nextIndex == currentIndex);
        }

        if (nextIndex >= queue.size()) {
            releasePlayer();
            cancelPlaybackNotification();
            updateMediaSessionState();
            notifyState(null);
            return;
        }

        loadIndex(nextIndex, true);
    }

    private void startProgress() {
        handler.removeCallbacks(progressTick);
        handler.postDelayed(progressTick, 1000);
    }

    private JSObject buildState(String error) {
        JSObject state = new JSObject();
        boolean isPlaying = false;
        double currentTime = 0;
        double duration = 0;

        if (player != null) {
            try {
                isPlaying = prepared && player.isPlaying();
                currentTime = prepared ? player.getCurrentPosition() / 1000.0 : 0;
                duration = prepared ? player.getDuration() / 1000.0 : 0;
            } catch (Exception ignored) {
                // Keep default state.
            }
        }

        state.put("index", currentIndex);
        state.put("playing", isPlaying);
        state.put("currentTime", currentTime);
        state.put("duration", duration);

        if (currentIndex >= 0 && currentIndex < queue.size()) {
            AudioTrack track = queue.get(currentIndex);
            state.put("artist", track.artist);
            state.put("id", track.id);
            state.put("title", track.title);
        }
        if (error != null && !error.isEmpty()) {
            state.put("error", error);
        }
        return state;
    }

    private void notifyState(String error) {
        notifyListeners("nativeAudioState", buildState(error), true);
    }

    private void releasePlayer() {
        handler.removeCallbacks(progressTick);
        if (player != null) {
            try {
                player.setOnCompletionListener(null);
                player.setOnErrorListener(null);
                player.stop();
            } catch (Exception ignored) {
                // Player may already be idle.
            }
            player.release();
            player = null;
        }
        prepared = false;
    }

    @Override
    protected void handleOnDestroy() {
        releasePlayer();
        cancelPlaybackNotification();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.handleOnDestroy();
    }
}
