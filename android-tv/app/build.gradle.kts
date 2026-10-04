plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tahlor.youtubeoverlay.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tahlor.youtubeoverlay.tv"
        minSdk = 23
        targetSdk = 32
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "OUTPUT_URL", "\"https://taylorarchibald.com/youtube_overlay/output\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
