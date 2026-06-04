package com.flowify.app;

import android.media.AudioAttributes;
import android.media.MediaPlayer;
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

@CapacitorPlugin(name = "FlowifyNativeAudio")
public class FlowifyNativeAudioPlugin extends Plugin {
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

    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
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
            notifyState(null);
        }
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (player != null && prepared && player.isPlaying()) {
            player.pause();
        }
        notifyState(null);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        releasePlayer();
        queue.clear();
        currentIndex = -1;
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

    private void loadIndex(int index, boolean autoplay) {
        releasePlayer();
        currentIndex = index;
        prepared = false;

        AudioTrack track = queue.get(index);
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
        super.handleOnDestroy();
    }
}
