// Device Types
export interface Device {
  serial: string;
  state: 'device' | 'offline' | 'unauthorized' | 'no permissions';
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

export interface DeviceInfo {
  serial: string;
  model: string;
  brand: string;
  manufacturer: string;
  androidVersion: string;
  sdkVersion: number;
  buildId: string;
}

// WiFi Types
export type SecurityType = 'open' | 'owe' | 'wpa2' | 'wpa3';

export interface ScanResult {
  ssid: string;
  bssid: string;
  frequency: number;
  rssi: number;           // Signal strength in dBm
  security: string;       // e.g., "WPA2-PSK", "WPA3-SAE", "Open"
  capabilities?: string;  // Raw capability string
}

export interface SavedNetwork {
  networkId: number;
  ssid: string;
}

export interface WifiStatus {
  enabled: boolean;
  connected: boolean;
  ssid?: string;
  bssid?: string;
  ipAddress?: string;
  linkSpeed?: number;
  rssi?: number;
  frequency?: number;
  networkId?: number;
  supplicantState?: string;
  macAddress?: string;
}

export interface WifiConnectionResult {
  success: boolean;
  ssid: string;
  error?: string;
}

// EAP Types (for 802.1X enterprise WiFi via companion app)
export type EapMethod = 'peap' | 'ttls' | 'tls';
export type Phase2Method = 'mschapv2' | 'pap' | 'gtc' | 'none';

export interface EapConfig {
  ssid: string;
  eapMethod: EapMethod;
  phase2Method?: Phase2Method;       // Required for PEAP/TTLS
  identity: string;                  // Username/email
  password?: string;                 // For PEAP/TTLS
  anonymousIdentity?: string;        // Outer identity (optional)
  domainSuffixMatch: string;         // Required for Android 11+
  caCertificate?: string;            // Base64-encoded PEM or file path
  clientCertificate?: string;        // Base64-encoded PEM (for EAP-TLS)
  privateKey?: string;               // Base64-encoded PEM (for EAP-TLS)
  privateKeyPassword?: string;       // If private key is encrypted
}

export interface EnterpriseConnectionResult {
  success: boolean;
  ssid: string;
  eapMethod: EapMethod;
  error?: string;
}

export interface CertificateInstallResult {
  success: boolean;
  alias: string;
  type: 'ca' | 'client';
  error?: string;
}

// Network Diagnostics Types
export interface PingResult {
  host: string;
  alive: boolean;
  time?: number;
  packetLoss?: number;
  output: string;
}

export interface DnsResult {
  hostname: string;
  addresses: string[];
  error?: string;
}

export interface ConnectivityResult {
  hasInternet: boolean;
  latency?: number;
  endpoint?: string;
  error?: string;
}

export interface CaptivePortalResult {
  isCaptive: boolean;
  portalUrl?: string;
  error?: string;
}

// ADB Command Result
export interface AdbResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}
