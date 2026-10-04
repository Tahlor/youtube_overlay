package com.tahlor.youtubeoverlay.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var pageReady = false
    private var pendingRemoteKey: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersiveMode()

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                loadsImagesAutomatically = true
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    pageReady = true
                    pendingRemoteKey?.let { dispatchRemoteKey(it) }
                    pendingRemoteKey = null
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    if (!request.isForMainFrame) return false
                    val target = request.url
                    return target.scheme != "https" ||
                        target.host != "taylorarchibald.com" ||
                        target.path?.startsWith("/youtube_overlay/output") != true
                }

            }
        }

        setContentView(webView)
        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.OUTPUT_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Suppress("DEPRECATION")
    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && !event.isCanceled) {
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                finish()
                return true
            }
            val remoteKey = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> "left"
                KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
                KeyEvent.KEYCODE_DPAD_UP -> "up"
                KeyEvent.KEYCODE_DPAD_DOWN -> "down"
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "center"
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "play-pause"
                KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
                KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
                KeyEvent.KEYCODE_VOLUME_MUTE -> "mute"
                else -> null
            }
            if (remoteKey != null) {
                if (event.repeatCount > 0) return true
                if (pageReady) dispatchRemoteKey(remoteKey) else pendingRemoteKey = remoteKey
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun dispatchRemoteKey(key: String) {
        val safeKey = org.json.JSONObject.quote(key)
        webView.evaluateJavascript(
            "(() => { const key = $safeKey; let attempts = 0; const send = () => { " +
                "if (window.__YT_TV_REMOTE_KEY__) window.__YT_TV_REMOTE_KEY__(key); " +
                "else if (attempts++ < 30) setTimeout(send, 100); }; send(); })()",
            null,
        )
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // This app contains only the audience output. Back always returns to the launcher.
        finish()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}
