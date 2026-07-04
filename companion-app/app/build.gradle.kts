plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.wifimcpcompanion"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.wifimcpcompanion"
        minSdk = 30  // Android 11+ required for enterprise WiFi
        targetSdk = 34
        versionCode = 4
        versionName = "1.3.0"  // WPA3-Enterprise support (securityType: wpa2-eap/wpa3-eap/wpa3-eap-192)
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("org.json:json:20231013")
}
