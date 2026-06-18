package com.myspeed.monitor

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class LanScanReport(
    val deviceId: String,
    val subnet: String,
    val hosts: List<LanHost>,
    val durationMs: Long
)

class Reporter {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json; charset=utf-8".toMediaType()

    fun send(serverUrl: String, report: NetworkReport): Result<Unit> {
        val url = serverUrl.trimEnd('/') + "/api/android/report"

        val body = JsonObject().apply {
            addProperty("device_id",   report.deviceId)
            addProperty("device_name", report.deviceName)
            addProperty("model",       report.model)
            addProperty("android_ver", report.androidVer)
            addProperty("ip_address",  report.ipAddress)
            report.pingMs?.let { addProperty("ping_ms", it) }

            report.wifi?.let { w ->
                add("wifi", JsonObject().apply {
                    addProperty("ssid",       w.ssid)
                    addProperty("bssid",      w.bssid)
                    addProperty("rssi",       w.rssi)
                    addProperty("frequency",  w.frequency)
                    addProperty("link_speed", w.linkSpeed)
                })
            }

            add("battery", JsonObject().apply {
                addProperty("percentage",  report.battery.percentage)
                addProperty("is_charging", report.battery.isCharging)
            })
        }

        return post(url, body)
    }

    fun sendLanScan(serverUrl: String, report: LanScanReport): Result<Unit> {
        val url = serverUrl.trimEnd('/') + "/api/android/scan"

        val hostsArray = JsonArray().apply {
            report.hosts.forEach { host ->
                add(JsonObject().apply {
                    addProperty("ip", host.ip)
                    host.mac?.let { addProperty("mac", it) }
                    host.hostname?.let { addProperty("hostname", it) }
                    host.latencyMs?.let { addProperty("latency_ms", it) }
                })
            }
        }

        val body = JsonObject().apply {
            addProperty("device_id",   report.deviceId)
            addProperty("subnet",      report.subnet)
            addProperty("duration_ms", report.durationMs)
            add("hosts", hostsArray)
        }

        return post(url, body)
    }

    private fun post(url: String, body: JsonObject): Result<Unit> = try {
        val req = Request.Builder()
            .url(url)
            .post(body.toString().toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .build()
        client.newCall(req).execute().use { resp ->
            if (resp.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("HTTP ${resp.code}"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
