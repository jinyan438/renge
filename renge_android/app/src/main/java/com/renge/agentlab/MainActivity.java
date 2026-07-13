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
import android.view.ViewGroup;
import android.widget.Toast;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.URLDecoder;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1201;
    private static final int DIRECTORY_PICKER_REQUEST = 1202;

    private WebView webView;
    private LocalWebServer localWebServer;
    private AndroidWorkspaceBridge androidWorkspaceBridge;
    private ValueCallback<Uri[]> fileChooserCallback;
    private BroadcastReceiver downloadCompleteReceiver;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

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

        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        androidWorkspaceBridge = new AndroidWorkspaceBridge(this, webView, DIRECTORY_PICKER_REQUEST);
        webView.addJavascriptInterface(androidWorkspaceBridge, "RengeAndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
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
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
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
        });

        try {
            localWebServer = new LocalWebServer(this);
            String appUrl = localWebServer.start();
            webView.loadUrl(appUrl);
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
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
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
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
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
