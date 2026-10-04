# YouTube Overlay TV

This Android TV app opens only the audience output at
`https://taylorarchibald.com/youtube_overlay/output`. It does not include or
link to the Director dashboard. The app runs fullscreen in landscape, keeps the
screen awake, and loads the same live output state used by a browser on the TV.

The APK uses the TV-specific output controls. Press **Back** to leave the app;
the remote's **Home** key returns to the Superbox launcher. While watching,
press an arrow key to reveal the small control bar, use Left/Right to select
Pause or Mute, then press OK. Media Play/Pause and Mute keys also work. Pause
is local to this TV: resuming rejoins the Director's current playback position.
The YouTube embed's full controls remain hidden so viewers cannot seek or choose
another video. YouTube's documented embed API does not offer a supported
captions on/off method; captions that the stream/video provides remain under
YouTube's own caption behavior.

Build a debug APK with Android SDK Platform 35 and JDK 17:

```powershell
$env:TEMP = 'D:\Dev\github\youtube_overlay\.build-tmp'
$env:TMP = $env:TEMP
$env:GRADLE_USER_HOME = 'D:\Dev\github\youtube_overlay\.gradle-cache'
$env:ANDROID_HOME = 'D:\Dev\github\youtube_overlay\.android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Set-Content local.properties 'sdk.dir=D:/Dev/github/youtube_overlay/.android-sdk'
./gradlew.bat --no-daemon assembleDebug
```

The APK is written to
`app\build\outputs\apk\debug\app-debug.apk`. Install it with
`adb install -r app\build\outputs\apk\debug\app-debug.apk`.
