package com.myspeed.monitor

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.myspeed.monitor.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        binding.editServerUrl.setText(prefs.serverUrl)
        binding.editDeviceName.setText(prefs.deviceName)
        binding.editInterval.setText(prefs.intervalSeconds.toString())
        binding.switchMonitor.isChecked = prefs.monitorEnabled

        binding.btnSave.setOnClickListener { saveAndApply() }
        binding.btnTestSend.setOnClickListener { testSend() }
        binding.switchMonitor.setOnCheckedChangeListener { _, checked ->
            prefs.monitorEnabled = checked
            if (checked) startMonitoring() else stopMonitoring()
        }

        requestNotificationPermission()
    }

    private fun saveAndApply() {
        val url      = binding.editServerUrl.text.toString().trim()
        val name     = binding.editDeviceName.text.toString().trim()
        val interval = binding.editInterval.text.toString().toIntOrNull() ?: 60

        if (url.isEmpty()) {
            binding.editServerUrl.error = "Server URL required"
            return
        }

        prefs.serverUrl      = url
        prefs.deviceName     = name.ifBlank { Build.MODEL }
        prefs.intervalSeconds = interval.coerceIn(10, 3600)

        Toast.makeText(this, "Settings saved", Toast.LENGTH_SHORT).show()

        if (prefs.monitorEnabled) {
            stopMonitoring()
            startMonitoring()
        }
    }

    private fun testSend() {
        val url = binding.editServerUrl.text.toString().trim()
        if (url.isEmpty()) {
            binding.editServerUrl.error = "Enter server URL first"
            return
        }

        binding.btnTestSend.isEnabled = false
        binding.tvStatus.text = "Sending test report…"

        lifecycleScope.launch {
            val collector = DataCollector(this@MainActivity)
            val reporter  = Reporter()
            val report    = withContext(Dispatchers.IO) {
                collector.collect(prefs.also { it.serverUrl = url })
            }
            val result = withContext(Dispatchers.IO) { reporter.send(url, report) }
            binding.btnTestSend.isEnabled = true
            if (result.isSuccess) {
                binding.tvStatus.text = "Test OK — data sent to server"
                Toast.makeText(this@MainActivity, "Success!", Toast.LENGTH_SHORT).show()
            } else {
                val msg = result.exceptionOrNull()?.message ?: "Unknown error"
                binding.tvStatus.text = "Error: $msg"
                Toast.makeText(this@MainActivity, "Failed: $msg", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun startMonitoring() {
        ContextCompat.startForegroundService(
            this,
            Intent(this, MonitorService::class.java)
        )
        binding.tvStatus.text = "Monitoring active"
    }

    private fun stopMonitoring() {
        stopService(Intent(this, MonitorService::class.java))
        binding.tvStatus.text = "Monitoring stopped"
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1
                )
            }
        }
    }
}
