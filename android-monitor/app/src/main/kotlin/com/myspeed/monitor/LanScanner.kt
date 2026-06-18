package com.myspeed.monitor

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.FileReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

data class LanHost(
    val ip: String,
    val mac: String?,
    val hostname: String?,
    val latencyMs: Long?
)

class LanScanner(private val context: Context) {

    suspend fun scan(): List<LanHost> = withContext(Dispatchers.IO) {
        val localIp = getLocalIp() ?: return@withContext emptyList()
        val prefix = localIp.substringBeforeLast(".")

        // Parallel probe all 254 addresses
        val probeResults: Map<String, Long> = (1..254)
            .map { i ->
                async {
                    val ip = "$prefix.$i"
                    val latency = probe(ip)
                    if (latency != null) ip to latency else null
                }
            }
            .awaitAll()
            .filterNotNull()
            .toMap()

        // Read ARP table after probing (TCP connects populated it)
        val arpTable = readArpTable()

        val allIps = (probeResults.keys + arpTable.keys)
            .filter { it.startsWith("$prefix.") }
            .toSet()

        allIps.mapNotNull { ip ->
            val latency = probeResults[ip]
            val mac = arpTable[ip]
            if (latency == null && mac == null) return@mapNotNull null
            LanHost(
                ip        = ip,
                mac       = mac,
                hostname  = resolveHostname(ip),
                latencyMs = latency
            )
        }.sortedBy { it.ip.substringAfterLast(".").toIntOrNull() ?: 999 }
    }

    private fun probe(ip: String, timeoutMs: Int = 150): Long? {
        val start = System.currentTimeMillis()
        return try {
            if (InetAddress.getByName(ip).isReachable(timeoutMs)) {
                System.currentTimeMillis() - start
            } else {
                tcpProbe(ip, 80, timeoutMs) ?: tcpProbe(ip, 443, timeoutMs)
            }
        } catch (_: Exception) {
            tcpProbe(ip, 80, timeoutMs) ?: tcpProbe(ip, 443, timeoutMs)
        }
    }

    private fun tcpProbe(ip: String, port: Int, timeoutMs: Int): Long? {
        val start = System.currentTimeMillis()
        return try {
            Socket().use { it.connect(InetSocketAddress(ip, port), timeoutMs) }
            System.currentTimeMillis() - start
        } catch (_: java.net.ConnectException) {
            // "Connection refused" = host is alive, port just not open
            System.currentTimeMillis() - start
        } catch (_: Exception) { null }
    }

    private fun resolveHostname(ip: String): String? = try {
        InetAddress.getByName(ip).canonicalHostName.takeIf { it != ip }
    } catch (_: Exception) { null }

    fun getLocalIp(): String? = try {
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val ipInt = wm.connectionInfo.ipAddress
        if (ipInt == 0) null
        else "${ipInt and 0xFF}.${ipInt shr 8 and 0xFF}.${ipInt shr 16 and 0xFF}.${ipInt shr 24 and 0xFF}"
    } catch (_: Exception) { null }

    private fun readArpTable(): Map<String, String?> {
        val result = mutableMapOf<String, String?>()
        try {
            BufferedReader(FileReader("/proc/net/arp")).use { reader ->
                reader.readLine() // skip header
                reader.forEachLine { line ->
                    val parts = line.trim().split(Regex("\\s+"))
                    if (parts.size >= 4) {
                        val ip = parts[0]
                        val mac = parts[3].takeIf { it != "00:00:00:00:00:00" && it.length == 17 }
                        result[ip] = mac
                    }
                }
            }
        } catch (_: Exception) {}
        return result
    }
}
