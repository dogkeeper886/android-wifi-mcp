package com.example.wifimcpcompanion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Environment
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Receives broadcast intents from ADB and processes enterprise WiFi commands
 */
class AdbBridgeReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "AdbBridgeReceiver"

        const val ACTION_CONNECT_ENTERPRISE = "com.example.wifimcpcompanion.CONNECT_ENTERPRISE"
        const val ACTION_INSTALL_CERTIFICATE = "com.example.wifimcpcompanion.INSTALL_CERTIFICATE"
        const val ACTION_LIST_CERTIFICATES = "com.example.wifimcpcompanion.LIST_CERTIFICATES"
        const val ACTION_DISCONNECT = "com.example.wifimcpcompanion.DISCONNECT"

        const val EXTRA_CONFIG_FILE = "config_file"

        private val COMMAND_FILE = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "wifi_mcp_command.json"
        )
        private val RESULT_FILE = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "wifi_mcp_result.json"
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "Received broadcast: ${intent.action}")

        try {
            when (intent.action) {
                ACTION_CONNECT_ENTERPRISE -> handleConnectEnterprise(context, intent)
                ACTION_INSTALL_CERTIFICATE -> handleInstallCertificate(context, intent)
                ACTION_LIST_CERTIFICATES -> handleListCertificates(context)
                ACTION_DISCONNECT -> handleDisconnect(context, intent)
                else -> {
                    Log.w(TAG, "Unknown action: ${intent.action}")
                    writeResult(false, "Unknown action", mapOf("action" to (intent.action ?: "null")))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing broadcast", e)
            writeResult(false, e.message ?: "Unknown error", mapOf("action" to (intent.action ?: "null")))
        }
    }

    private fun handleConnectEnterprise(context: Context, intent: Intent) {
        val configFile = intent.getStringExtra(EXTRA_CONFIG_FILE) ?: COMMAND_FILE.absolutePath
        val config = readConfigFile(configFile)

        if (config == null) {
            writeResult(false, "Failed to read config file", mapOf("action" to "connect_enterprise"))
            return
        }

        val ssid = config.getString("ssid")
        val eapMethod = config.getString("eapMethod")
        val identity = config.getString("identity")
        val domainSuffixMatch = config.getString("domainSuffixMatch")
        val password = config.optString("password", null)
        val phase2Method = config.optString("phase2Method", "mschapv2")
        val anonymousIdentity = config.optString("anonymousIdentity", null)
        val caCertificate = config.optString("caCertificate", null)
        val clientCertificate = config.optString("clientCertificate", null)
        val privateKey = config.optString("privateKey", null)
        val privateKeyPassword = config.optString("privateKeyPassword", null)

        val wifiManager = WifiEnterpriseManager(context)

        val result = when (eapMethod.lowercase()) {
            "peap" -> wifiManager.connectPeap(
                ssid = ssid,
                identity = identity,
                password = password ?: "",
                domain = domainSuffixMatch,
                caCertPem = caCertificate,
                anonymousIdentity = anonymousIdentity,
                phase2Method = wifiManager.getPhase2Method(phase2Method)
            )
            "ttls" -> wifiManager.connectTtls(
                ssid = ssid,
                identity = identity,
                password = password ?: "",
                domain = domainSuffixMatch,
                caCertPem = caCertificate,
                anonymousIdentity = anonymousIdentity,
                phase2Method = wifiManager.getPhase2Method(phase2Method)
            )
            "tls" -> {
                if (clientCertificate == null || privateKey == null) {
                    writeResult(
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
                    caCertPem = caCertificate
                )
            }
            else -> {
                writeResult(
                    false,
                    "Unknown EAP method: $eapMethod",
                    mapOf("action" to "connect_enterprise", "ssid" to ssid)
                )
                return
            }
        }

        writeResult(
            result.success,
            result.message ?: result.error ?: "Unknown",
            mapOf(
                "action" to "connect_enterprise",
                "ssid" to result.ssid,
                "eapMethod" to result.eapMethod
            )
        )
    }

    private fun handleInstallCertificate(context: Context, intent: Intent) {
        val configFile = intent.getStringExtra(EXTRA_CONFIG_FILE) ?: COMMAND_FILE.absolutePath
        val config = readConfigFile(configFile)

        if (config == null) {
            writeResult(false, "Failed to read config file", mapOf("action" to "install_certificate"))
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
            result.success,
            result.message ?: result.error ?: "Unknown",
            mapOf(
                "action" to "install_certificate",
                "alias" to alias,
                "type" to type
            )
        )
    }

    private fun handleListCertificates(context: Context) {
        val certManager = CertificateManager(context)
        val certificates = certManager.listCertificates()

        writeResult(
            true,
            "Found ${certificates.size} certificates",
            mapOf(
                "action" to "list_certificates",
                "certificates" to certificates
            )
        )
    }

    private fun handleDisconnect(context: Context, intent: Intent) {
        val configFile = intent.getStringExtra(EXTRA_CONFIG_FILE) ?: COMMAND_FILE.absolutePath
        val config = readConfigFile(configFile)

        val ssid = config?.optString("ssid", null)

        if (ssid != null) {
            val wifiManager = WifiEnterpriseManager(context)
            val removed = wifiManager.removeNetworkSuggestion(ssid)

            writeResult(
                removed,
                if (removed) "Network suggestion removed" else "Failed to remove network suggestion",
                mapOf("action" to "disconnect", "ssid" to ssid)
            )
        } else {
            writeResult(false, "SSID is required for disconnect", mapOf("action" to "disconnect"))
        }
    }

    private fun readConfigFile(path: String): JSONObject? {
        return try {
            val file = File(path)
            if (!file.exists()) {
                Log.e(TAG, "Config file not found: $path")
                return null
            }
            val content = file.readText()
            JSONObject(content)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read config file: $path", e)
            null
        }
    }

    private fun writeResult(success: Boolean, message: String, extra: Map<String, Any> = emptyMap()) {
        try {
            val result = JSONObject().apply {
                put("success", success)
                put("message", message)
                put("timestamp", System.currentTimeMillis())
                extra.forEach { (key, value) ->
                    put(key, value)
                }
            }

            RESULT_FILE.parentFile?.mkdirs()
            RESULT_FILE.writeText(result.toString(2))
            Log.i(TAG, "Result written to ${RESULT_FILE.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write result file", e)
        }
    }
}
