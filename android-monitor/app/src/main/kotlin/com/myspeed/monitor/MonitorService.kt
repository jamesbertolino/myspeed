package com.myspeed.monitor

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*

class MonitorService : Service() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var prefs: Prefs
    private lateinit var collector: DataCollector
    private lateinit var reporter: Reporter
    private var job: Job? = null

    override fun onCreate() {
        super.onCreate()
        prefs     = Prefs(this)
        collector = DataCollector(this)
        reporter  = Reporter()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopSelf()
            else        -> startMonitoring()
        }
        return START_STICKY
    }

    private fun startMonitoring() {
        startForeground(NOTIF_ID, buildNotification("Monitoring…"))
        job?.cancel()
        job = scope.launch {
            while (isActive) {
                val url = prefs.serverUrl
                if (url.isNotBlank()) {
                    try {
                        val report = collector.collect(prefs)
                        val result = reporter.send(url, report)
                        val msg = if (result.isSuccess) "Last report: OK"
                                  else "Last report: ${result.exceptionOrNull()?.message}"
                        updateNotification(msg)
                        Log.d(TAG, msg)
                    } catch (e: Exception) {
                        Log.e(TAG, "Monitor error", e)
                    }
                }
                delay(prefs.intervalSeconds * 1000L)
            }
        }
    }

    private fun buildNotification(status: String) =
        NotificationCompat.Builder(this, MonitorApp.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setContentTitle("MySpeed Monitor")
            .setContentText(status)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE
                )
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Stop",
                PendingIntent.getService(
                    this, 1,
                    Intent(this, MonitorService::class.java).apply { action = ACTION_STOP },
                    PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

    private fun updateNotification(status: String) {
        val nm = getSystemService(android.app.NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotification(status))
    }

    override fun onDestroy() {
        job?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val TAG       = "MonitorService"
        const val NOTIF_ID  = 1001
        const val ACTION_STOP = "com.myspeed.monitor.STOP"
    }
}
