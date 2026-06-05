package com.flowify.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class FlowifyMediaButtonReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        FlowifyNativeAudioPlugin.handleNotificationAction(intent.getAction());
    }
}
