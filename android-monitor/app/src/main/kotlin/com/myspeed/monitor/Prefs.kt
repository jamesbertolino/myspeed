package com.myspeed.monitor

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("myspeed_monitor", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", "") ?: ""
        set(v) = sp.edit().putString("server_url", v).apply()

    var intervalSeconds: Int
        get() = sp.getInt("interval_sec", 60)
        set(v) = sp.edit().putInt("interval_sec", v).apply()

    var deviceName: String
        get() = sp.getString("device_name", android.os.Build.MODEL) ?: android.os.Build.MODEL
        set(v) = sp.edit().putString("device_name", v).apply()

    val deviceId: String
        get() {
            var id = sp.getString("device_id", null)
            if (id == null) {
                id = UUID.randomUUID().toString()
                sp.edit().putString("device_id", id).apply()
            }
            return id
        }

    var monitorEnabled: Boolean
        get() = sp.getBoolean("monitor_enabled", false)
        set(v) = sp.edit().putBoolean("monitor_enabled", v).apply()
}
