package com.renge.agentlab;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

public class BackgroundRuntimeService extends Service {
    private static final String TAG = "RengeBackground";
    private static final String NOTIFICATION_CHANNEL_ID = "conversation_generation";
    private static final int NOTIFICATION_ID = 5191;
    private static final long FOREGROUND_RELEASE_DELAY_MS = 15000L;

    public final class LocalBinder extends Binder {
        BackgroundRuntimeService getService() {
            return BackgroundRuntimeService.this;
        }
    }

    private final IBinder binder = new LocalBinder();
    private final AtomicInteger activeGenerationRequests = new AtomicInteger();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable leaveForegroundRunnable = this::leaveForegroundGenerationMode;

    private LocalWebServer localWebServer;
    private String serverUrl;
    private IOException startupError;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private int boundClients;
    private boolean foreground;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        createPowerLocks();
        try {
            localWebServer = new LocalWebServer(this, new LocalWebServer.RequestLifecycleListener() {
                @Override
                public void onGenerationRequestStarted() {
                    handleGenerationRequestStarted();
                }

                @Override
                public void onGenerationRequestFinished() {
                    handleGenerationRequestFinished();
                }
            });
            serverUrl = localWebServer.start();
        } catch (IOException error) {
            startupError = error;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        boundClients += 1;
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        boundClients = Math.max(0, boundClients - 1);
        stopWhenIdle();
        return false;
    }

    String getServerUrl() throws IOException {
        if (startupError != null) throw startupError;
        if (serverUrl == null) throw new IOException("Android 本地服务尚未准备好");
        return serverUrl;
    }

    private void handleGenerationRequestStarted() {
        int activeRequests = activeGenerationRequests.incrementAndGet();
        mainHandler.removeCallbacks(leaveForegroundRunnable);
        if (activeRequests == 1) {
            mainHandler.post(this::enterForegroundGenerationMode);
        }
    }

    private void handleGenerationRequestFinished() {
        int remaining = activeGenerationRequests.updateAndGet(value -> Math.max(0, value - 1));
        if (remaining == 0) {
            mainHandler.removeCallbacks(leaveForegroundRunnable);
            mainHandler.postDelayed(leaveForegroundRunnable, FOREGROUND_RELEASE_DELAY_MS);
        }
    }

    private void enterForegroundGenerationMode() {
        if (activeGenerationRequests.get() == 0 || foreground) return;
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        foreground = true;
        acquirePowerLocks();
    }

    private void leaveForegroundGenerationMode() {
        if (activeGenerationRequests.get() != 0) return;
        releasePowerLocks();
        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        stopWhenIdle();
    }

    private void stopWhenIdle() {
        if (boundClients == 0 && activeGenerationRequests.get() == 0) stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.background_generation_channel),
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.background_generation_channel_description));
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                0,
                openAppIntent,
                pendingIntentFlags
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_stat_renge)
                .setContentTitle(getString(R.string.background_generation_title))
                .setContentText(getString(R.string.background_generation_message))
                .setContentIntent(contentIntent)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    @SuppressWarnings("deprecation")
    private void createPowerLocks() {
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    getPackageName() + ":conversation-generation"
            );
            wakeLock.setReferenceCounted(false);
        }

        WifiManager wifiManager = (WifiManager) getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    getPackageName() + ":conversation-generation"
            );
            wifiLock.setReferenceCounted(false);
        }
    }

    @SuppressLint("WakelockTimeout")
    private void acquirePowerLocks() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to acquire a background generation lock", error);
        }
    }

    private void releasePowerLocks() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to release a background generation lock", error);
        }
    }

    @Override
    public void onTimeout(int startId, int foregroundServiceType) {
        Log.w(TAG, "Background generation exceeded the Android foreground-service limit");
        activeGenerationRequests.set(0);
        leaveForegroundGenerationMode();
        stopSelf(startId);
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        releasePowerLocks();
        if (localWebServer != null) {
            localWebServer.stop();
            localWebServer = null;
        }
        super.onDestroy();
    }
}
