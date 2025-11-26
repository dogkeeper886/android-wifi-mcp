# Add project specific ProGuard rules here.

# Keep broadcast receiver
-keep class com.example.wifimcpcompanion.AdbBridgeReceiver { *; }

# Keep data classes
-keep class com.example.wifimcpcompanion.WifiEnterpriseManager$ConnectionResult { *; }
-keep class com.example.wifimcpcompanion.CertificateManager$CertificateResult { *; }
