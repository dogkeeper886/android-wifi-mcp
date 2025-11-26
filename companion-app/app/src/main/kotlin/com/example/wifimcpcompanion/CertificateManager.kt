package com.example.wifimcpcompanion

import android.content.Context
import android.security.KeyChain
import android.util.Log
import java.io.ByteArrayInputStream
import java.security.KeyFactory
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

/**
 * Manages certificate installation and retrieval for enterprise WiFi
 */
class CertificateManager(private val context: Context) {

    companion object {
        private const val TAG = "CertificateManager"
        private const val KEYSTORE_TYPE = "AndroidKeyStore"
    }

    data class CertificateResult(
        val success: Boolean,
        val alias: String,
        val message: String? = null,
        val error: String? = null
    )

    /**
     * Install a CA certificate
     * Note: On Android 11+, this will prompt the user to install the certificate
     */
    fun installCaCertificate(certPem: String, alias: String): CertificateResult {
        return try {
            val cert = parseCertificate(certPem)

            // For CA certificates, we need to use the system certificate store
            // This typically requires user interaction on modern Android
            val keyStore = KeyStore.getInstance(KEYSTORE_TYPE)
            keyStore.load(null)

            // Check if already installed
            if (keyStore.containsAlias(alias)) {
                return CertificateResult(
                    success = true,
                    alias = alias,
                    message = "Certificate already installed"
                )
            }

            // Note: Direct installation to system CA store requires device admin or root
            // For user CA store, we need to trigger the system installer

            // Store in app's private keystore for now
            keyStore.setCertificateEntry(alias, cert)

            Log.i(TAG, "CA certificate stored: $alias")
            CertificateResult(
                success = true,
                alias = alias,
                message = "Certificate stored in app keystore. For system-wide trust, manual installation may be required."
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to install CA certificate", e)
            CertificateResult(
                success = false,
                alias = alias,
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * Install a client certificate with private key
     */
    fun installClientCertificate(
        certPem: String,
        privateKeyPem: String,
        keyPassword: String?,
        alias: String
    ): CertificateResult {
        return try {
            val cert = parseCertificate(certPem)
            val privateKey = parsePrivateKey(privateKeyPem, keyPassword)

            val keyStore = KeyStore.getInstance(KEYSTORE_TYPE)
            keyStore.load(null)

            // Store the key entry
            keyStore.setKeyEntry(
                alias,
                privateKey,
                null, // Android KeyStore doesn't use passwords
                arrayOf(cert)
            )

            Log.i(TAG, "Client certificate installed: $alias")
            CertificateResult(
                success = true,
                alias = alias,
                message = "Client certificate installed successfully"
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to install client certificate", e)
            CertificateResult(
                success = false,
                alias = alias,
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * List all certificates in the Android KeyStore
     */
    fun listCertificates(): List<String> {
        return try {
            val keyStore = KeyStore.getInstance(KEYSTORE_TYPE)
            keyStore.load(null)

            keyStore.aliases().toList()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to list certificates", e)
            emptyList()
        }
    }

    /**
     * Get a certificate by alias
     */
    fun getCertificate(alias: String): X509Certificate? {
        return try {
            val keyStore = KeyStore.getInstance(KEYSTORE_TYPE)
            keyStore.load(null)

            keyStore.getCertificate(alias) as? X509Certificate
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get certificate: $alias", e)
            null
        }
    }

    /**
     * Delete a certificate
     */
    fun deleteCertificate(alias: String): Boolean {
        return try {
            val keyStore = KeyStore.getInstance(KEYSTORE_TYPE)
            keyStore.load(null)

            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
                Log.i(TAG, "Certificate deleted: $alias")
                true
            } else {
                Log.w(TAG, "Certificate not found: $alias")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete certificate: $alias", e)
            false
        }
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
}
