package com.example.wifimcpcompanion

import android.content.Context
import android.net.wifi.WifiEnterpriseConfig
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import android.util.Log
import java.io.ByteArrayInputStream
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

/**
 * Manages enterprise WiFi (802.1X/EAP) connections
 */
class WifiEnterpriseManager(private val context: Context) {

    companion object {
        private const val TAG = "WifiEnterpriseManager"
    }

    private val wifiManager: WifiManager by lazy {
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    }

    data class ConnectionResult(
        val success: Boolean,
        val ssid: String,
        val eapMethod: String,
        val message: String? = null,
        val error: String? = null
    )

    /**
     * Connect to an enterprise WiFi network using EAP-PEAP
     */
    fun connectPeap(
        ssid: String,
        identity: String,
        password: String,
        domain: String,
        caCertPem: String? = null,
        anonymousIdentity: String? = null,
        phase2Method: Int = WifiEnterpriseConfig.Phase2.MSCHAPV2
    ): ConnectionResult {
        return try {
            val enterpriseConfig = WifiEnterpriseConfig().apply {
                eapMethod = WifiEnterpriseConfig.Eap.PEAP
                this.phase2Method = phase2Method
                this.identity = identity
                this.password = password
                anonymousIdentity?.let { this.anonymousIdentity = it }

                // CA certificate (required for Android 11+)
                caCertPem?.let {
                    caCertificate = parseCertificate(it)
                }

                // Domain suffix match (required for security)
                setDomainSuffixMatch(domain)
            }

            addNetworkSuggestion(ssid, enterpriseConfig, "peap")
        } catch (e: Exception) {
            Log.e(TAG, "PEAP connection failed", e)
            ConnectionResult(
                success = false,
                ssid = ssid,
                eapMethod = "peap",
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * Connect to an enterprise WiFi network using EAP-TTLS
     */
    fun connectTtls(
        ssid: String,
        identity: String,
        password: String,
        domain: String,
        caCertPem: String? = null,
        anonymousIdentity: String? = null,
        phase2Method: Int = WifiEnterpriseConfig.Phase2.MSCHAPV2
    ): ConnectionResult {
        return try {
            val enterpriseConfig = WifiEnterpriseConfig().apply {
                eapMethod = WifiEnterpriseConfig.Eap.TTLS
                this.phase2Method = phase2Method
                this.identity = identity
                this.password = password
                anonymousIdentity?.let { this.anonymousIdentity = it }

                caCertPem?.let {
                    caCertificate = parseCertificate(it)
                }

                setDomainSuffixMatch(domain)
            }

            addNetworkSuggestion(ssid, enterpriseConfig, "ttls")
        } catch (e: Exception) {
            Log.e(TAG, "TTLS connection failed", e)
            ConnectionResult(
                success = false,
                ssid = ssid,
                eapMethod = "ttls",
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * Connect to an enterprise WiFi network using EAP-TLS (certificate-based)
     */
    fun connectTls(
        ssid: String,
        identity: String,
        domain: String,
        clientCertPem: String,
        privateKeyPem: String,
        privateKeyPassword: String? = null,
        caCertPem: String? = null
    ): ConnectionResult {
        return try {
            val clientCert = parseCertificate(clientCertPem)
            val privateKey = parsePrivateKey(privateKeyPem, privateKeyPassword)

            val enterpriseConfig = WifiEnterpriseConfig().apply {
                eapMethod = WifiEnterpriseConfig.Eap.TLS
                this.identity = identity

                // Set client certificate and private key
                setClientKeyEntry(privateKey, clientCert)

                caCertPem?.let {
                    caCertificate = parseCertificate(it)
                }

                setDomainSuffixMatch(domain)
            }

            addNetworkSuggestion(ssid, enterpriseConfig, "tls")
        } catch (e: Exception) {
            Log.e(TAG, "TLS connection failed", e)
            ConnectionResult(
                success = false,
                ssid = ssid,
                eapMethod = "tls",
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * Add network suggestion using WifiNetworkSuggestion API
     */
    private fun addNetworkSuggestion(
        ssid: String,
        enterpriseConfig: WifiEnterpriseConfig,
        eapMethod: String
    ): ConnectionResult {
        // Remove any existing suggestion for this SSID first
        removeNetworkSuggestion(ssid)

        val suggestion = WifiNetworkSuggestion.Builder()
            .setSsid(ssid)
            .setWpa2EnterpriseConfig(enterpriseConfig)
            .setIsAppInteractionRequired(false)
            .build()

        val status = wifiManager.addNetworkSuggestions(listOf(suggestion))

        return when (status) {
            WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS -> {
                Log.i(TAG, "Network suggestion added successfully for $ssid")
                ConnectionResult(
                    success = true,
                    ssid = ssid,
                    eapMethod = eapMethod,
                    message = "Network suggestion added. Device will connect when network is available."
                )
            }
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE -> {
                Log.w(TAG, "Duplicate network suggestion for $ssid")
                ConnectionResult(
                    success = true,
                    ssid = ssid,
                    eapMethod = eapMethod,
                    message = "Network suggestion already exists"
                )
            }
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_APP_DISALLOWED -> {
                ConnectionResult(
                    success = false,
                    ssid = ssid,
                    eapMethod = eapMethod,
                    error = "App is not allowed to add network suggestions. User must approve in settings."
                )
            }
            else -> {
                ConnectionResult(
                    success = false,
                    ssid = ssid,
                    eapMethod = eapMethod,
                    error = "Failed to add network suggestion. Status code: $status"
                )
            }
        }
    }

    /**
     * Remove network suggestion for an SSID
     */
    fun removeNetworkSuggestion(ssid: String): Boolean {
        val suggestion = WifiNetworkSuggestion.Builder()
            .setSsid(ssid)
            .build()

        val status = wifiManager.removeNetworkSuggestions(listOf(suggestion))
        return status == WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS
    }

    /**
     * Parse PEM-encoded X.509 certificate
     */
    private fun parseCertificate(pemData: String): X509Certificate {
        val cleanedPem = pemData
            .replace("-----BEGIN CERTIFICATE-----", "")
            .replace("-----END CERTIFICATE-----", "")
            .replace("\\s".toRegex(), "")

        val decoded = Base64.getDecoder().decode(cleanedPem)
        val certFactory = CertificateFactory.getInstance("X.509")
        return certFactory.generateCertificate(ByteArrayInputStream(decoded)) as X509Certificate
    }

    /**
     * Parse PEM-encoded private key
     */
    private fun parsePrivateKey(pemData: String, password: String? = null): PrivateKey {
        val cleanedPem = pemData
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("-----BEGIN RSA PRIVATE KEY-----", "")
            .replace("-----END RSA PRIVATE KEY-----", "")
            .replace("-----BEGIN EC PRIVATE KEY-----", "")
            .replace("-----END EC PRIVATE KEY-----", "")
            .replace("\\s".toRegex(), "")

        val decoded = Base64.getDecoder().decode(cleanedPem)
        val keySpec = PKCS8EncodedKeySpec(decoded)

        // Try RSA first, then EC
        return try {
            KeyFactory.getInstance("RSA").generatePrivate(keySpec)
        } catch (e: Exception) {
            KeyFactory.getInstance("EC").generatePrivate(keySpec)
        }
    }

    /**
     * Get Phase2 method constant from string
     */
    fun getPhase2Method(method: String): Int {
        return when (method.lowercase()) {
            "mschapv2" -> WifiEnterpriseConfig.Phase2.MSCHAPV2
            "pap" -> WifiEnterpriseConfig.Phase2.PAP
            "gtc" -> WifiEnterpriseConfig.Phase2.GTC
            "none" -> WifiEnterpriseConfig.Phase2.NONE
            else -> WifiEnterpriseConfig.Phase2.MSCHAPV2
        }
    }
}
