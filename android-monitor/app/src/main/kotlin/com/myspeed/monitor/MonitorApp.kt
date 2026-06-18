package com.myspeed.monitor

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class MonitorApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "MySpeed Monitor",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Background network monitoring service"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "myspeed_monitor"
    }
}
