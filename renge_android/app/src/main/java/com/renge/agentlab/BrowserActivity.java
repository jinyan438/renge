package com.renge.agentlab;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

public class BrowserActivity extends Activity {
    public static final String EXTRA_URL = "com.renge.agentlab.BROWSER_URL";

    private WebView webView;
    private EditText addressInput;
    private Button backButton;
    private Button forwardButton;
    private Button reloadButton;
    private ProgressBar progressBar;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(6), dp(6), dp(6), dp(6));
        toolbar.setBackgroundColor(Color.rgb(246, 246, 248));

        backButton = createToolbarButton("‹", "后退");
        forwardButton = createToolbarButton("›", "前进");
        reloadButton = createToolbarButton("↻", "刷新");
        addressInput = new EditText(this);
        addressInput.setSingleLine(true);
        addressInput.setSelectAllOnFocus(true);
        addressInput.setTextSize(14);
        addressInput.setHint("输入网址或搜索内容");
        addressInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        LinearLayout.LayoutParams addressParams = new LinearLayout.LayoutParams(0, dp(40), 1f);
        addressParams.setMargins(dp(4), 0, dp(4), 0);
        Button goButton = createToolbarButton("打开", "打开网址");
        goButton.setMinWidth(dp(58));

        toolbar.addView(backButton);
        toolbar.addView(forwardButton);
        toolbar.addView(reloadButton);
        toolbar.addView(addressInput, addressParams);
        toolbar.addView(goButton);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);

        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        root.addView(progressBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(2)
        ));
        root.addView(webView);
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception error) {
                    Toast.makeText(BrowserActivity.this, "无法打开此链接", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                addressInput.setText(url);
                progressBar.setVisibility(ProgressBar.VISIBLE);
                updateNavigationButtons();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                addressInput.setText(url);
                updateNavigationButtons();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? ProgressBar.GONE : ProgressBar.VISIBLE);
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (title != null && !title.trim().isEmpty()) setTitle(title);
            }
        });

        View.OnClickListener openCurrentAddress = view -> loadAddress(addressInput.getText().toString());
        goButton.setOnClickListener(openCurrentAddress);
        addressInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_GO
                    && (event == null || event.getKeyCode() != android.view.KeyEvent.KEYCODE_ENTER)) {
                return false;
            }
            loadAddress(view.getText().toString());
            return true;
        });
        backButton.setOnClickListener(view -> {
            if (webView.canGoBack()) webView.goBack();
        });
        forwardButton.setOnClickListener(view -> {
            if (webView.canGoForward()) webView.goForward();
        });
        reloadButton.setOnClickListener(view -> webView.reload());

        loadAddress(getIntent().getStringExtra(EXTRA_URL));
    }

    private Button createToolbarButton(String text, String description) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setContentDescription(description);
        button.setMinWidth(dp(42));
        button.setMinimumWidth(0);
        button.setMinHeight(dp(40));
        button.setMinimumHeight(0);
        return button;
    }

    private void loadAddress(String rawAddress) {
        String url = normalizeAddress(rawAddress);
        if (url == null) {
            Toast.makeText(this, "仅支持 HTTP 或 HTTPS 网页", Toast.LENGTH_SHORT).show();
            return;
        }
        addressInput.setText(url);
        webView.loadUrl(url);
    }

    private String normalizeAddress(String rawAddress) {
        String value = rawAddress == null ? "" : rawAddress.trim();
        if (value.isEmpty()) return "about:blank";
        Uri uri = Uri.parse(value);
        if (uri.getScheme() == null) uri = Uri.parse("https://" + value);
        String scheme = uri.getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)
                ? uri.toString()
                : null;
    }

    private void updateNavigationButtons() {
        backButton.setEnabled(webView.canGoBack());
        forwardButton.setEnabled(webView.canGoForward());
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
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
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
