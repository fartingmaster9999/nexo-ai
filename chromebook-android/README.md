# Nexo AI for Chromebook

This is a small Android app shell for Chromebooks with Android app support. It opens the approved Nexo website in a dedicated app window; it does not bundle provider credentials or copy the website into the APK. An internet connection is required.

The app keeps WebView storage private to Nexo, allows file selection for chat attachments, and asks for microphone permission only when Nexo Live requests it. Microphone access is restricted to `https://nexo-ai-tawny.vercel.app`.

## Build and download the APK

The GitHub Actions workflow **Build Nexo Chromebook APK** builds a debug APK when changes are pushed to `main`, or when manually started from the repository's Actions tab.

1. Push this folder and `.github/workflows/build-chromebook-apk.yml` to GitHub.
2. Open the repository's **Actions** tab and select **Build Nexo Chromebook APK**.
3. Open the completed run and download the `nexo-chromebook-debug-apk` artifact.
4. Extract the artifact to get `app-debug.apk`.

This debug APK is signed with Android's automatically generated debug key. It is for testing, not Google Play publication. A Play Store release requires a separately managed release-signing setup.

## Chromebook installation note

Downloading an APK and installing it are separate steps. ChromeOS may require an administrator-approved sideloading method, Linux/ADB, or distribution through Google Play. The district has approved the app's Nexo access; confirm the device's APK-install method with its administrator before attempting installation. This project does not change ChromeOS security settings.
