package com.nexoai.chromebook;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final String START_URL = "https://nexo-ai-tawny.vercel.app/";
    private static final String ALLOWED_HOST = "nexo-ai-tawny.vercel.app";
    private static final int AUDIO_PERMISSION_REQUEST = 41;
    private static final int FILE_PICKER_REQUEST = 42;
    private static final int BACKGROUND = Color.rgb(8, 11, 18);
    private static final int ACCENT = Color.rgb(57, 136, 255);

    private WebView webView;
    private ProgressBar progressBar;
    private View errorPanel;
    private PermissionRequest pendingAudioRequest;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        setContentView(createLayout());
        configureWebView();

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            return;
        }
        webView.loadUrl(START_URL);
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(BACKGROUND);
        window.setNavigationBarColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }
    }

    private View createLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets systemBars =
                        insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(0, systemBars.top, 0, systemBars.bottom);
                return insets;
            });
        }

        webView = new WebView(this);
        root.addView(
                webView,
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        progressBar.setProgressBackgroundTintList(
                android.content.res.ColorStateList.valueOf(Color.rgb(22, 30, 44)));
        FrameLayout.LayoutParams progressParams =
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP);
        root.addView(progressBar, progressParams);

        errorPanel = createErrorPanel();
        errorPanel.setVisibility(View.GONE);
        root.addView(
                errorPanel,
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
        return root;
    }

    private View createErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(32), dp(24), dp(32), dp(24));
        panel.setBackgroundColor(BACKGROUND);

        TextView title = new TextView(this);
        title.setText(R.string.connection_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        panel.addView(title, matchWrap());

        TextView message = new TextView(this);
        message.setText(R.string.connection_message);
        message.setTextColor(Color.rgb(165, 177, 198));
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = matchWrap();
        messageParams.topMargin = dp(10);
        panel.addView(message, messageParams);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(
                android.content.res.ColorStateList.valueOf(ACCENT));
        retry.setOnClickListener(view -> {
            errorPanel.setVisibility(View.GONE);
            progressBar.setVisibility(View.VISIBLE);
            webView.loadUrl(START_URL);
        });
        LinearLayout.LayoutParams retryParams =
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        retryParams.topMargin = dp(22);
        panel.addView(retry, retryParams);
        return panel;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.setBackgroundColor(BACKGROUND);
        webView.setWebViewClient(new NexoWebViewClient());
        webView.setWebChromeClient(new NexoWebChromeClient());
        android.webkit.CookieManager.getInstance().setAcceptCookie(true);
    }

    private boolean isNexoUrl(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && ALLOWED_HOST.equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void openExternalHttpsUrl(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Leave unsupported links in the app instead of crashing the WebView.
        }
    }

    private void showLoadError() {
        progressBar.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private boolean requestMicrophone(PermissionRequest request) {
        if (request == null || !isNexoUrl(request.getOrigin())) {
            if (request != null) {
                request.deny();
            }
            return false;
        }

        String[] requestedResources = request.getResources();
        if (requestedResources == null
                || requestedResources.length != 1
                || !PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(requestedResources[0])) {
            request.deny();
            return false;
        }

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return true;
        }

        if (pendingAudioRequest != null) {
            pendingAudioRequest.deny();
        }
        pendingAudioRequest = request;
        requestPermissions(
                new String[] {Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
        return true;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_PICKER_REQUEST || pendingFileCallback == null) {
            return;
        }

        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clipData = data.getClipData();
            if (clipData != null) {
                results = new Uri[clipData.getItemCount()];
                for (int index = 0; index < clipData.getItemCount(); index++) {
                    results[index] = clipData.getItemAt(index).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[] {data.getData()};
            }
        }
        pendingFileCallback.onReceiveValue(results);
        pendingFileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUDIO_PERMISSION_REQUEST || pendingAudioRequest == null) {
            return;
        }

        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED
                && isNexoUrl(request.getOrigin())) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingAudioRequest != null) {
            pendingAudioRequest.deny();
            pendingAudioRequest = null;
        }
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class NexoWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isNexoUrl(uri)) {
                return false;
            }
            openExternalHttpsUrl(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            errorPanel.setVisibility(View.GONE);
            progressBar.setProgress(0);
            progressBar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progressBar.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(
                WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showLoadError();
            }
        }
    }

    private final class NexoWebChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int progress) {
            progressBar.setProgress(progress);
            if (progress >= 100) {
                progressBar.setVisibility(View.GONE);
            } else if (errorPanel.getVisibility() != View.VISIBLE) {
                progressBar.setVisibility(View.VISIBLE);
            }
        }

        @Override
        public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams) {
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(null);
            }
            pendingFileCallback = filePathCallback;

            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            picker.setType("*/*");
            picker.putExtra(
                    Intent.EXTRA_ALLOW_MULTIPLE,
                    fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            try {
                startActivityForResult(
                        Intent.createChooser(picker, getString(R.string.choose_file)),
                        FILE_PICKER_REQUEST);
                return true;
            } catch (Exception exception) {
                pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = null;
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> requestMicrophone(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingAudioRequest == request) {
                pendingAudioRequest = null;
            }
        }
    }
}
