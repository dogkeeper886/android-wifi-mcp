package com.example.wifimcpcompanion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Receives broadcast intents from ADB and processes enterprise WiFi commands.
 *
 * IPC files live in the app's private filesDir (`/data/data/<pkg>/files/`)
 * and are accessed from the host via `adb shell run-as <pkg> ...`. The
 * previous location `/sdcard/Download/` is unreadable to the app on
 * Android 11+ when written by adb shell (scoped storage / EACCES).
 */
class AdbBridgeReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "AdbBridgeReceiver"

        const val ACTION_CONNECT_ENTERPRISE = "com.example.wifimcpcompanion.CONNECT_ENTERPRISE"
        const val ACTION_INSTALL_CERTIFICATE = "com.example.wifimcpcompanion.INSTALL_CERTIFICATE"
        const val ACTION_LIST_CERTIFICATES = "com.example.wifimcpcompanion.LIST_CERTIFICATES"
        const val ACTION_DISCONNECT = "com.example.wifimcpcompanion.DISCONNECT"
        const val ACTION_LIST_NOTIFICATIONS = "com.example.wifimcpcompanion.LIST_NOTIFICATIONS"
        const val ACTION_NOTIFICATION_STATUS = "com.example.wifimcpcompanion.NOTIFICATION_STATUS"

        private const val COMMAND_FILE_NAME = "wifi_mcp_command.json"
        private const val RESULT_FILE_NAME = "wifi_mcp_result.json"
    }

    private fun commandFile(context: Context) = File(context.filesDir, COMMAND_FILE_NAME)
    private fun resultFile(context: Context) = File(context.filesDir, RESULT_FILE_NAME)

    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "Received broadcast: ${intent.action}")

        try {
            when (intent.action) {
                ACTION_CONNECT_ENTERPRISE -> handleConnectEnterprise(context)
                ACTION_INSTALL_CERTIFICATE -> handleInstallCertificate(context)
                ACTION_LIST_CERTIFICATES -> handleListCertificates(context)
                ACTION_DISCONNECT -> handleDisconnect(context)
                ACTION_LIST_NOTIFICATIONS -> handleListNotifications(context)
                ACTION_NOTIFICATION_STATUS -> handleNotificationStatus(context)
                else -> {
                    Log.w(TAG, "Unknown action: ${intent.action}")
                    writeResult(context, false, "Unknown action", mapOf("action" to (intent.action ?: "null")))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing broadcast", e)
            writeResult(context, false, e.message ?: "Unknown error", mapOf("action" to (intent.action ?: "null")))
        }
    }

    private fun handleConnectEnterprise(context: Context) {
        val config = readConfigFile(commandFile(context))

        if (config == null) {
            writeResult(context, false, "Failed to read config file", mapOf("action" to "connect_enterprise"))
            return
        }

        val ssid = config.getString("ssid")
        val eapMethod = config.getString("eapMethod")
        val identity = config.getString("identity")
        val domainSuffixMatch = config.optString("domainSuffixMatch", "")
        val trustOnFirstUse = config.optBoolean("trustOnFirstUse", false)
        val password = config.optString("password", null)
        val phase2Method = config.optString("phase2Method", "mschapv2")
        val anonymousIdentity = config.optString("anonymousIdentity", null)
        val caCertificate = config.optString("caCertificate", null)
        val clientCertificate = config.optString("clientCertificate", null)
        val privateKey = config.optString("privateKey", null)
        val privateKeyPassword = config.optString("privateKeyPassword", null)

        if (trustOnFirstUse && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            writeResult(
                context,
                false,
                "trustOnFirstUse requires Android 13+ (API 33); this device is API ${Build.VERSION.SDK_INT}. Provide caCertificate and/or domainSuffixMatch instead.",
                mapOf("action" to "connect_enterprise", "ssid" to ssid, "eapMethod" to eapMethod)
            )
            return
        }

        val wifiManager = WifiEnterpriseManager(context)

        val result = when (eapMethod.lowercase()) {
            "peap" -> wifiManager.connectPeap(
                ssid = ssid,
                identity = identity,
                password = password ?: "",
                domain = domainSuffixMatch,
                caCertPem = caCertificate,
                anonymousIdentity = anonymousIdentity,
                phase2Method = wifiManager.getPhase2Method(phase2Method),
                trustOnFirstUse = trustOnFirstUse
            )
            "ttls" -> wifiManager.connectTtls(
                ssid = ssid,
                identity = identity,
                password = password ?: "",
                domain = domainSuffixMatch,
                caCertPem = caCertificate,
                anonymousIdentity = anonymousIdentity,
                phase2Method = wifiManager.getPhase2Method(phase2Method),
                trustOnFirstUse = trustOnFirstUse
            )
            "tls" -> {
                if (clientCertificate == null || privateKey == null) {
                    writeResult(
                        context,
                        false,
                        "Client certificate and private key are required for EAP-TLS",
                        mapOf("action" to "connect_enterprise", "ssid" to ssid, "eapMethod" to eapMethod)
                    )
                    return
                }
                wifiManager.connectTls(
                    ssid = ssid,
                    identity = identity,
                    domain = domainSuffixMatch,
                    clientCertPem = clientCertificate,
                    privateKeyPem = privateKey,
                    privateKeyPassword = privateKeyPassword,
                    caCertPem = caCertificate,
                    trustOnFirstUse = trustOnFirstUse
                )
            }
            else -> {
                writeResult(
                    context,
                    false,
                    "Unknown EAP method: $eapMethod",
                    mapOf("action" to "connect_enterprise", "ssid" to ssid)
                )
                return
            }
        }

        writeResult(
            context,
            result.success,
            result.message ?: result.error ?: "Unknown",
            mapOf(
                "action" to "connect_enterprise",
                "ssid" to result.ssid,
                "eapMethod" to result.eapMethod
            )
        )
    }

    private fun handleInstallCertificate(context: Context) {
        val config = readConfigFile(commandFile(context))

        if (config == null) {
            writeResult(context, false, "Failed to read config file", mapOf("action" to "install_certificate"))
            return
        }

        val certificate = config.getString("certificate")
        val alias = config.getString("alias")
        val type = config.getString("type")

        val certManager = CertificateManager(context)

        val result = when (type.lowercase()) {
            "ca" -> certManager.installCaCertificate(certificate, alias)
            "client" -> {
                // For client certificates, we need the private key too
                val privateKey = config.optString("privateKey", null)
                val privateKeyPassword = config.optString("privateKeyPassword", null)
                if (privateKey != null) {
                    certManager.installClientCertificate(certificate, privateKey, privateKeyPassword, alias)
                } else {
                    CertificateManager.CertificateResult(
                        success = false,
                        alias = alias,
                        error = "Private key is required for client certificates"
                    )
                }
            }
            else -> CertificateManager.CertificateResult(
                success = false,
                alias = alias,
                error = "Unknown certificate type: $type"
            )
        }

        writeResult(
            context,
            result.success,
            result.message ?: result.error ?: "Unknown",
            mapOf(
                "action" to "install_certificate",
                "alias" to alias,
                "type" to type
            )
        )
    }

    private fun handleListNotifications(context: Context) {
        // Optional filter params from the command file (sinceMs, packageFilter, limit).
        val cfg = readConfigFile(commandFile(context))
        val sinceMs = cfg?.optLong("sinceMs", 0L) ?: 0L
        val packageFilter = cfg?.optString("packageFilter", null)
        val limit = cfg?.optInt("limit", 50) ?: 50

        if (!NotificationCaptureService.listenerConnected) {
            writeResult(
                context,
                false,
                "NotificationCaptureService is not connected. Has notification access been granted? See Settings → Notifications → Notification access.",
                mapOf("action" to "list_notifications")
            )
            return
        }

        val packageRegex = packageFilter?.let { Regex(it, RegexOption.IGNORE_CASE) }
        val matches = NotificationCaptureService.captured
            .asSequence()
            .filter { it.timestamp >= sinceMs }
            .filter { packageRegex == null || packageRegex.containsMatchIn(it.packageName) }
            .take(limit)
            .map { n ->
                mapOf(
                    "packageName" to n.packageName,
                    "title" to n.title,
                    "text" to n.text,
                    "timestamp" to n.timestamp
                )
            }
            .toList()

        writeResult(
            context,
            true,
            "Returned ${matches.size} notification(s)",
            mapOf(
                "action" to "list_notifications",
                "count" to matches.size,
                "notifications" to matches
            )
        )
    }

    private fun handleNotificationStatus(context: Context) {
        writeResult(
            context,
            true,
            if (NotificationCaptureService.listenerConnected) "Notification listener connected" else "Notification access not granted",
            mapOf(
                "action" to "notification_status",
                "listenerConnected" to NotificationCaptureService.listenerConnected,
                "capturedCount" to NotificationCaptureService.captured.size
            )
        )
    }

    private fun handleListCertificates(context: Context) {
        val certManager = CertificateManager(context)
        val certificates = certManager.listCertificates()

        writeResult(
            context,
            true,
            "Found ${certificates.size} certificates",
            mapOf(
                "action" to "list_certificates",
                "certificates" to certificates
            )
        )
    }

    private fun handleDisconnect(context: Context) {
        val config = readConfigFile(commandFile(context))

        val ssid = config?.optString("ssid", null)

        if (ssid != null) {
            val wifiManager = WifiEnterpriseManager(context)
            val removed = wifiManager.removeNetworkSuggestion(ssid)

            writeResult(
                context,
                removed,
                if (removed) "Network suggestion removed" else "Failed to remove network suggestion",
                mapOf("action" to "disconnect", "ssid" to ssid)
            )
        } else {
            writeResult(context, false, "SSID is required for disconnect", mapOf("action" to "disconnect"))
        }
    }

    private fun readConfigFile(file: File): JSONObject? {
        return try {
            if (!file.exists()) {
                Log.e(TAG, "Config file not found: ${file.absolutePath}")
                return null
            }
            JSONObject(file.readText())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read config file: ${file.absolutePath}", e)
            null
        }
    }

    private fun writeResult(context: Context, success: Boolean, message: String, extra: Map<String, Any> = emptyMap()) {
        try {
            val result = JSONObject().apply {
                put("success", success)
                put("message", message)
                put("timestamp", System.currentTimeMillis())
                extra.forEach { (key, value) ->
                    put(key, toJson(value))
                }
            }

            val outFile = resultFile(context)
            outFile.parentFile?.mkdirs()
            outFile.writeText(result.toString(2))
            Log.i(TAG, "Result written to ${outFile.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write result file", e)
        }
    }

    /** Recursively wrap nested Map / Collection in JSONObject / JSONArray so they serialize properly. */
    private fun toJson(value: Any?): Any? {
        return when (value) {
            null -> JSONObject.NULL
            is Map<*, *> -> JSONObject().apply {
                value.forEach { (k, v) -> if (k != null) put(k.toString(), toJson(v)) }
            }
            is Collection<*> -> JSONArray().apply {
                value.forEach { put(toJson(it)) }
            }
            else -> value
        }
    }
}
