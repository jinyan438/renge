package com.renge.agentlab;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.URLDecoder;
import java.util.Collections;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1201;
    private static final int DIRECTORY_PICKER_REQUEST = 1202;
    private static final String HTML_PREVIEW_HOST = "html-preview.renge.invalid";
    private static final String BROWSER_INTENT_SCHEME = "renge-browser";
    private static final String ANDROID_USER_AGENT_TOKEN = "RengeAgentLabAndroid";

    private WebView webView;
    private FrameLayout rootLayout;
    private AndroidBrowserHost androidBrowserHost;
    private LocalWebServer localWebServer;
    private AndroidWorkspaceBridge androidWorkspaceBridge;
    private ValueCallback<Uri[]> fileChooserCallback;
    private BroadcastReceiver downloadCompleteReceiver;
    private View customFullscreenView;
    private WebChromeClient.CustomViewCallback customFullscreenCallback;
    private boolean htmlFullscreenActive;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        rootLayout = new FrameLayout(this);
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        rootLayout.addView(webView);
        setContentView(rootLayout);
        androidBrowserHost = new AndroidBrowserHost(this, rootLayout, webView);

        WebView.setWebContentsDebuggingEnabled(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        String defaultUserAgent = settings.getUserAgentString();
        if (defaultUserAgent == null || !defaultUserAgent.contains(ANDROID_USER_AGENT_TOKEN)) {
            settings.setUserAgentString((defaultUserAgent == null ? "" : defaultUserAgent + " ")
                    + ANDROID_USER_AGENT_TOKEN);
        }

        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        androidWorkspaceBridge = new AndroidWorkspaceBridge(this, webView, DIRECTORY_PICKER_REQUEST);
        webView.addJavascriptInterface(androidWorkspaceBridge, "RengeAndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HTML_PREVIEW_HOST.equalsIgnoreCase(uri.getHost())
                        && "/html-preview-frame.html".equals(uri.getPath())) {
                    try {
                        WebResourceResponse response = new WebResourceResponse(
                                "text/html",
                                "UTF-8",
                                getAssets().open("www/html-preview-frame.html")
                        );
                        response.setStatusCodeAndReasonPhrase(200, "OK");
                        response.setResponseHeaders(Collections.singletonMap(
                                "Cache-Control",
                                "no-store"
                        ));
                        return response;
                    } catch (Exception ignored) {
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (BROWSER_INTENT_SCHEME.equalsIgnoreCase(scheme)) {
                    openBrowserIntent(uri);
                    return true;
                }
                return !("http".equals(scheme) || "https".equals(scheme));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (androidWorkspaceBridge != null) {
                    androidWorkspaceBridge.injectApi();
                }
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                String fileName = getDownloadFileName(url, contentDisposition);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent == null ? "" : userAgent);
                request.setTitle(fileName);
                request.setDescription(contentLength > 0
                        ? "正在下载电脑工作区文件（" + formatBytes(contentLength) + "）"
                        : "正在下载电脑工作区文件");
                request.setMimeType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (downloadManager == null) throw new IllegalStateException("系统下载管理器不可用");
                downloadManager.enqueue(request);
                Toast.makeText(this, "已开始下载：" + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "下载失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        downloadCompleteReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                    Toast.makeText(context, "下载完成，可在系统下载目录查看", Toast.LENGTH_LONG).show();
                }
            }
        };
        IntentFilter downloadCompleteFilter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadCompleteReceiver, downloadCompleteFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadCompleteReceiver, downloadCompleteFilter);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                showCustomFullscreenView(view, callback);
            }

            @Override
            public void onHideCustomView() {
                hideCustomFullscreenView();
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                return openFileChooser(filePathCallback, fileChooserParams);
            }
        });

        try {
            localWebServer = new LocalWebServer(this);
            String appUrl = localWebServer.start();
            webView.loadUrl(appUrl + "?rengePlatform=android");
        } catch (Exception error) {
            webView.loadData(
                    "<html><body><h1>Renge Android 启动失败</h1><pre>"
                            + error.getMessage()
                            + "</pre></body></html>",
                    "text/html",
                    "UTF-8"
            );
        }
    }

    private void openBrowserIntent(Uri uri) {
        String action = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        try {
            JSONObject options = new JSONObject();
            options.put("command", action);
            options.put("tabId", uri.getQueryParameter("tabId") == null
                    ? "android-intent-tab"
                    : uri.getQueryParameter("tabId"));
            options.put("url", uri.getQueryParameter("url"));
            options.put("left", uri.getQueryParameter("left"));
            options.put("top", uri.getQueryParameter("top"));
            options.put("width", uri.getQueryParameter("width"));
            options.put("height", uri.getQueryParameter("height"));
            handleAndroidBrowserCommand(options);
        } catch (Exception error) {
            Toast.makeText(this, "浏览器操作失败：" + error.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    JSONObject handleAndroidBrowserCommand(JSONObject options) throws Exception {
        if (androidBrowserHost == null) throw new IllegalStateException("Android 浏览器尚未准备好");
        return androidBrowserHost.command(options);
    }

    void handleAndroidBrowserRequest(String requestId, JSONObject options) {
        if (androidBrowserHost == null) return;
        androidBrowserHost.request(requestId, options);
    }

    void showEmbeddedBrowser(String url) {
        try {
            JSONObject options = new JSONObject();
            options.put("command", "open");
            options.put("tabId", "android-default-tab");
            options.put("url", url);
            handleAndroidBrowserCommand(options);
        } catch (Exception error) {
            Toast.makeText(this, "浏览器打开失败：" + error.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    boolean openFileChooser(
            ValueCallback<Uri[]> filePathCallback,
            WebChromeClient.FileChooserParams fileChooserParams
    ) {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        fileChooserCallback = filePathCallback;
        Intent intent = fileChooserParams.createIntent();
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(intent, FILE_CHOOSER_REQUEST);
            return true;
        } catch (Exception ignored) {
            fileChooserCallback = null;
            return false;
        }
    }

    void showCustomFullscreenView(View view, WebChromeClient.CustomViewCallback callback) {
        if (customFullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customFullscreenView = view;
        customFullscreenCallback = callback;
        FrameLayout decor = (FrameLayout) getWindow().getDecorView();
        view.setBackgroundColor(Color.BLACK);
        decor.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        webView.setVisibility(View.GONE);
        hideSystemBars();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == DIRECTORY_PICKER_REQUEST && androidWorkspaceBridge != null) {
            androidWorkspaceBridge.handleActivityResult(resultCode, data);
            return;
        }

        if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) {
            return;
        }

        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null && data.getClipData() != null) {
            ClipData clipData = data.getClipData();
            results = new Uri[clipData.getItemCount()];
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                results[index] = clipData.getItemAt(index).getUri();
            }
        } else {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }
        fileChooserCallback.onReceiveValue(results);
        fileChooserCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (customFullscreenView != null) {
            hideCustomFullscreenView();
            return;
        }
        if (htmlFullscreenActive) {
            exitHtmlFullscreen(true);
            return;
        }
        if (androidBrowserHost != null && androidBrowserHost.handleBackPressed()) return;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        hideCustomFullscreenView();
        if (downloadCompleteReceiver != null) {
            try {
                unregisterReceiver(downloadCompleteReceiver);
            } catch (Exception ignored) {
            }
            downloadCompleteReceiver = null;
        }
        if (localWebServer != null) {
            localWebServer.stop();
        }
        if (androidBrowserHost != null) androidBrowserHost.destroy();
        androidBrowserHost = null;
        if (androidWorkspaceBridge != null) androidWorkspaceBridge.dispose();
        androidWorkspaceBridge = null;
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    void enterHtmlFullscreen() {
        htmlFullscreenActive = true;
        hideSystemBars();
    }

    void exitHtmlFullscreen(boolean notifyPage) {
        if (!htmlFullscreenActive) return;
        htmlFullscreenActive = false;
        if (customFullscreenView == null) showSystemBars();
        if (notifyPage && webView != null) {
            webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('renge-native-fullscreen-exit'))",
                    null
            );
        }
    }

    void hideCustomFullscreenView() {
        if (customFullscreenView == null) return;
        ViewGroup parent = (ViewGroup) customFullscreenView.getParent();
        if (parent != null) parent.removeView(customFullscreenView);
        customFullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        if (customFullscreenCallback != null) {
            customFullscreenCallback.onCustomViewHidden();
            customFullscreenCallback = null;
        }
        if (!htmlFullscreenActive) showSystemBars();
    }

    private void hideSystemBars() {
        View decorView = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
            return;
        }
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void showSystemBars() {
        View decorView = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
            getWindow().setDecorFitsSystemWindows(true);
            return;
        }
        decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private String getDownloadFileName(String url, String contentDisposition) {
        String fileName = parseContentDispositionFileName(contentDisposition);
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = getQueryParameter(url, "downloadName");
        }
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = getQueryParameter(url, "path");
            if (fileName != null) {
                int slashIndex = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
                if (slashIndex >= 0) fileName = fileName.substring(slashIndex + 1);
            }
        }
        if (fileName == null || fileName.trim().isEmpty()) fileName = "download";
        return fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private String parseContentDispositionFileName(String contentDisposition) {
        if (contentDisposition == null) return null;
        String[] parts = contentDisposition.split(";");
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.toLowerCase().startsWith("filename*=")) {
                String value = trimmed.substring(trimmed.indexOf('=') + 1).trim();
                int charsetIndex = value.indexOf("''");
                if (charsetIndex >= 0) value = value.substring(charsetIndex + 2);
                return decodeURIComponent(stripQuotes(value));
            }
        }
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.toLowerCase().startsWith("filename=")) {
                return decodeURIComponent(stripQuotes(trimmed.substring(trimmed.indexOf('=') + 1).trim()));
            }
        }
        return null;
    }

    private String getQueryParameter(String url, String key) {
        try {
            Uri uri = Uri.parse(url);
            String value = uri.getQueryParameter(key);
            return value == null ? null : decodeURIComponent(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String stripQuotes(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }

    private String decodeURIComponent(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (Exception ignored) {
            return value;
        }
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double value = bytes / 1024.0;
        if (value < 1024) return String.format(java.util.Locale.US, "%.1f KB", value);
        value /= 1024.0;
        if (value < 1024) return String.format(java.util.Locale.US, "%.1f MB", value);
        value /= 1024.0;
        return String.format(java.util.Locale.US, "%.1f GB", value);
    }
}
