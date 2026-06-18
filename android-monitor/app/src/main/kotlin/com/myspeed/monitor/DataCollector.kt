package com.myspeed.monitor

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.InetAddress
import java.net.NetworkInterface

data class WifiInfo(
    val ssid: String?,
    val bssid: String?,
    val rssi: Int?,
    val frequency: Int?,
    val linkSpeed: Int?,
)

data class BatteryInfo(
    val percentage: Int,
    val isCharging: Boolean,
)

data class NetworkReport(
    val deviceId: String,
    val deviceName: String,
    val model: String,
    val androidVer: String,
    val wifi: WifiInfo?,
    val ipAddress: String?,
    val pingMs: Double?,
    val battery: BatteryInfo,
)

class DataCollector(private val context: Context) {

    fun collectWifi(): WifiInfo? {
        val wm = context.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val info = wm.connectionInfo ?: return null
        val ssid = info.ssid?.removePrefix("\"")?.removeSuffix("\"")
        if (ssid.isNullOrBlank() || ssid == "<unknown ssid>") return null
        return WifiInfo(
            ssid      = ssid,
            bssid     = info.bssid,
            rssi      = info.rssi,
            frequency = info.frequency,
            linkSpeed = info.linkSpeed,
        )
    }

    fun collectBattery(): BatteryInfo {
        val filter  = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val intent  = context.registerReceiver(null, filter)
        val level   = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale   = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status  = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val pct     = if (scale > 0) (level * 100 / scale) else level
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                       status == BatteryManager.BATTERY_STATUS_FULL
        return BatteryInfo(pct, charging)
    }

    fun getLocalIp(): String? {
        try {
            val ifaces = NetworkInterface.getNetworkInterfaces() ?: return null
            for (iface in ifaces.asSequence()) {
                if (!iface.isUp || iface.isLoopback) continue
                for (addr in iface.inetAddresses.asSequence()) {
                    if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (_: Exception) {}
        return null
    }

    suspend fun measurePing(host: String = "8.8.8.8"): Double? = withContext(Dispatchers.IO) {
        try {
            val start  = System.currentTimeMillis()
            val reachable = InetAddress.getByName(host).isReachable(3000)
            val elapsed = System.currentTimeMillis() - start
            if (reachable) elapsed.toDouble() else null
        } catch (_: Exception) { null }
    }

    fun isOnline(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net  = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    suspend fun collect(prefs: Prefs): NetworkReport {
        val wifi    = collectWifi()
        val battery = collectBattery()
        val ip      = getLocalIp()
        val ping    = if (isOnline()) measurePing() else null
        return NetworkReport(
            deviceId    = prefs.deviceId,
            deviceName  = prefs.deviceName,
            model       = Build.MODEL,
            androidVer  = Build.VERSION.RELEASE,
            wifi        = wifi,
            ipAddress   = ip,
            pingMs      = ping,
            battery     = battery,
        )
    }
}
