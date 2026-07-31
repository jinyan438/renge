package com.renge.agentlab;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

final class AndroidBrowserHost {
    private static final String EVENT_NAME = "renge-android-browser-event";
    private static final String RESOLVE_NAME = "__rengeAndroidResolve";
    private static final String REJECT_NAME = "__rengeAndroidReject";

    private final Activity activity;
    private final FrameLayout rootLayout;
    private final WebView appWebView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, BrowserTab> tabs = new LinkedHashMap<>();
    private final Map<Long, BrowserDownload> downloads = new LinkedHashMap<>();
    private String activeTabId = "";
    private boolean visible;
    private boolean suspended;
    private int left;
    private int top;
    private int width = 1;
    private int height = 1;
    private int scriptSequence;

    AndroidBrowserHost(Activity activity, FrameLayout rootLayout, WebView appWebView) {
        this.activity = activity;
        this.rootLayout = rootLayout;
        this.appWebView = appWebView;
    }

    JSONObject command(JSONObject options) throws Exception {
        String command = options.optString("command", "").trim().toLowerCase(Locale.US);
        String tabId = options.optString("tabId", activeTabId).trim();
        updateBounds(options);
        switch (command) {
            case "create":
                requireTabId(tabId);
                ensureTab(tabId);
                return ok(command);
            case "select":
                requireTabId(tabId);
                selectTab(tabId, options.optBoolean("show", true));
                return statePayload(requireTab(tabId));
            case "open": {
                requireTabId(tabId);
                String url = requireHttpUrl(options.optString("url", ""));
                BrowserTab tab = ensureTab(tabId);
                selectTab(tabId, true);
                tab.webView.loadUrl(url);
                return statePayload(tab);
            }
            case "layout":
                applyBoundsToActiveTab();
                return ok(command);
            case "back": {
                BrowserTab tab = requireTab(tabId);
                if (tab.webView.canGoBack()) tab.webView.goBack();
                return statePayload(tab);
            }
            case "forward": {
                BrowserTab tab = requireTab(tabId);
                if (tab.webView.canGoForward()) tab.webView.goForward();
                return statePayload(tab);
            }
            case "reload": {
                BrowserTab tab = requireTab(tabId);
                tab.webView.reload();
                return statePayload(tab);
            }
            case "stop": {
                BrowserTab tab = requireTab(tabId);
                tab.webView.stopLoading();
                tab.loading = false;
                dispatchState(tab);
                return statePayload(tab);
            }
            case "close_tab":
                closeTab(tabId);
                return ok(command);
            case "hide":
            case "close":
                hide();
                return ok(command);
            case "suspend":
                for (BrowserTab tab : tabs.values()) tab.webView.setVisibility(View.GONE);
                suspended = true;
                return ok(command);
            case "show":
                selectTab(tabId, true);
                return ok(command);
            case "zoom": {
                BrowserTab tab = requireTab(tabId);
                float nextZoom = (float) Math.max(0.25, Math.min(3, options.optDouble("factor", 1)));
                float ratio = nextZoom / Math.max(0.01f, tab.zoomFactor);
                tab.webView.zoomBy(ratio);
                tab.zoomFactor = nextZoom;
                return statePayload(tab);
            }
            case "find": {
                BrowserTab tab = requireTab(tabId);
                String query = options.optString("query", "");
                if (options.optBoolean("findNext", false)) {
                    tab.webView.findNext(options.optBoolean("forward", true));
                } else {
                    tab.webView.findAllAsync(query);
                }
                return ok(command);
            }
            case "stop_find":
                requireTab(tabId).webView.clearMatches();
                return ok(command);
            case "input":
                dispatchInput(requireTab(tabId), options);
                return ok(command);
            case "download":
                enqueueDownload(options.optString("url", ""), null, null, null);
                return ok(command);
            case "clear_data":
                clearData(options.optString("action", "all"));
                return ok(command);
            case "device_mode":
                setDesktopMode(requireTab(tabId), options.optBoolean("enabled", false));
                return ok(command);
            case "copy_text":
                copyText(options.optString("text", ""));
                return ok(command);
            case "copy_image":
                copyImage(options.optString("url", ""));
                return ok(command);
            case "open_external":
                openExternal(options.optString("url", ""));
                return ok(command);
            case "context_done":
                selectTab(tabId, true);
                return ok(command);
            case "download_action":
                runDownloadAction(options);
                return ok(command);
            default:
                throw new IllegalArgumentException("未知 Android 浏览器操作：" + command);
        }
    }

    void request(String requestId, JSONObject options) {
        String operation = options.optString("operation", "");
        String tabId = options.optString("tabId", activeTabId);
        try {
            switch (operation) {
                case "execute":
                    executeScript(requestId, requireTab(tabId), options.optString("script", ""));
                    return;
                case "capture":
                    resolve(requestId, capture(requireTab(tabId), options.optJSONObject("rect")));
                    return;
                case "downloads":
                    resolve(requestId, downloadsPayload());
                    return;
                case "profile":
                    resolve(requestId, profilePayload());
                    return;
                default:
                    reject(requestId, "未知 Android 浏览器请求：" + operation);
            }
        } catch (Exception error) {
            reject(requestId, error.getMessage());
        }
    }

    boolean handleBackPressed() {
        if (!visible) return false;
        BrowserTab tab = tabs.get(activeTabId);
        if (suspended && tab != null) {
            dispatchEvent(event("dismiss-overlays", tab));
            return true;
        }
        if (tab != null && tab.webView.canGoBack()) tab.webView.goBack();
        else hide();
        return true;
    }

    void destroy() {
        for (BrowserTab tab : tabs.values()) {
            tab.webView.stopLoading();
            rootLayout.removeView(tab.webView);
            tab.webView.destroy();
        }
        tabs.clear();
        downloads.clear();
    }

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    private BrowserTab ensureTab(String tabId) {
        BrowserTab existing = tabs.get(tabId);
        if (existing != null) return existing;

        WebView browser = new WebView(activity);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
        browser.setBackgroundColor(Color.WHITE);
        browser.setVisibility(View.GONE);

        BrowserTab tab = new BrowserTab(tabId, browser, settings.getUserAgentString());
        browser.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return false;
                openExternal(uri.toString());
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                tab.loading = true;
                dispatchEvent(event("did-start-loading", tab));
                dispatchState(tab);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                tab.loading = false;
                JSONObject navigation = event("did-navigate", tab);
                put(navigation, "url", url);
                dispatchEvent(navigation);
                dispatchEvent(event("did-stop-loading", tab));
                dispatchState(tab);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                JSONObject navigation = event("did-navigate-in-page", tab);
                put(navigation, "url", url);
                put(navigation, "isReload", isReload);
                dispatchEvent(navigation);
                dispatchState(tab);
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                if (!request.isForMainFrame()) return;
                tab.loading = false;
                JSONObject payload = event("did-fail-load", tab);
                put(payload, "errorCode", error.getErrorCode());
                put(payload, "errorDescription", String.valueOf(error.getDescription()));
                put(payload, "isMainFrame", true);
                dispatchEvent(payload);
                dispatchState(tab);
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                tab.loading = newProgress < 100;
                dispatchState(tab);
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                JSONObject payload = event("page-title-updated", tab);
                put(payload, "title", title);
                dispatchEvent(payload);
                dispatchState(tab);
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                return activity instanceof MainActivity
                        && ((MainActivity) activity).openFileChooser(filePathCallback, fileChooserParams);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (activity instanceof MainActivity) {
                    ((MainActivity) activity).showCustomFullscreenView(view, callback);
                } else {
                    callback.onCustomViewHidden();
                }
            }

            @Override
            public void onHideCustomView() {
                if (activity instanceof MainActivity) {
                    ((MainActivity) activity).hideCustomFullscreenView();
                }
            }

            @Override
            public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
            ) {
                WebView popup = new WebView(activity);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        JSONObject payload = event("open-tab", tab);
                        put(payload, "url", request.getUrl().toString());
                        dispatchEvent(payload);
                        popupView.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        browser.setFindListener((activeMatchOrdinal, numberOfMatches, isDoneCounting) -> {
            JSONObject payload = event("found-in-page", tab);
            put(payload, "activeMatchOrdinal", activeMatchOrdinal);
            put(payload, "matches", numberOfMatches);
            put(payload, "finalUpdate", isDoneCounting);
            dispatchEvent(payload);
        });
        browser.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                enqueueDownload(url, contentDisposition, mimeType, userAgent));
        browser.setOnTouchListener((view, motionEvent) -> {
            if (motionEvent.getActionMasked() == MotionEvent.ACTION_DOWN) {
                tab.lastTouchX = motionEvent.getX();
                tab.lastTouchY = motionEvent.getY();
            }
            return false;
        });
        browser.setOnLongClickListener(view -> {
            showContextMenu(tab);
            return true;
        });

        rootLayout.addView(browser, new FrameLayout.LayoutParams(1, 1));
        tabs.put(tabId, tab);
        return tab;
    }

    private void selectTab(String tabId, boolean show) {
        BrowserTab target = ensureTab(tabId);
        for (BrowserTab tab : tabs.values()) tab.webView.setVisibility(View.GONE);
        activeTabId = tabId;
        visible = show;
        suspended = false;
        if (show) {
            applyBounds(target.webView);
            target.webView.setVisibility(View.VISIBLE);
            target.webView.bringToFront();
            dispatchState(target);
        }
    }

    private void closeTab(String tabId) {
        BrowserTab tab = tabs.remove(tabId);
        if (tab == null) return;
        tab.webView.stopLoading();
        rootLayout.removeView(tab.webView);
        tab.webView.destroy();
        if (tabId.equals(activeTabId)) {
            activeTabId = "";
            visible = false;
        }
    }

    private void hide() {
        visible = false;
        suspended = false;
        for (BrowserTab tab : tabs.values()) tab.webView.setVisibility(View.GONE);
    }

    private void updateBounds(JSONObject options) {
        if (options.has("left")) left = Math.max(0, options.optInt("left", left));
        if (options.has("top")) top = Math.max(0, options.optInt("top", top));
        if (options.has("width")) width = Math.max(1, options.optInt("width", width));
        if (options.has("height")) height = Math.max(1, options.optInt("height", height));
    }

    private void applyBoundsToActiveTab() {
        BrowserTab tab = tabs.get(activeTabId);
        if (tab != null) applyBounds(tab.webView);
    }

    private void applyBounds(WebView browser) {
        int safeLeft = Math.max(0, left);
        int safeTop = Math.max(0, top);
        int safeWidth = width;
        int safeHeight = height;
        if (rootLayout.getWidth() > safeLeft) safeWidth = Math.min(safeWidth, rootLayout.getWidth() - safeLeft);
        if (rootLayout.getHeight() > safeTop) safeHeight = Math.min(safeHeight, rootLayout.getHeight() - safeTop);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                Math.max(1, safeWidth),
                Math.max(1, safeHeight)
        );
        params.leftMargin = safeLeft;
        params.topMargin = safeTop;
        browser.setLayoutParams(params);
    }

    private void executeScript(String requestId, BrowserTab tab, String script) {
        if (script.trim().isEmpty()) {
            reject(requestId, "页面脚本不能为空");
            return;
        }
        String resultId = "r" + System.currentTimeMillis() + "_" + (++scriptSequence);
        String wrapped = "(function(){var id=" + JSONObject.quote(resultId) + ";"
                + "var results=window.__rengeAndroidBrowserResults||(window.__rengeAndroidBrowserResults={});"
                + "Promise.resolve().then(function(){return (" + script + ");}).then(function(value){"
                + "try{results[id]={ok:true,value:value===undefined?null:value};}catch(error){results[id]={ok:false,error:{message:String(error&&error.message||error)}};}"
                + "},function(error){results[id]={ok:false,error:{name:String(error&&error.name||'Error'),message:String(error&&error.message||error),stack:String(error&&error.stack||'').slice(0,6000)}};});"
                + "return true;})()";
        tab.webView.evaluateJavascript(wrapped, ignored -> pollScriptResult(requestId, tab, resultId, 0));
    }

    private void pollScriptResult(String requestId, BrowserTab tab, String resultId, int attempt) {
        if (!tabs.containsKey(tab.id)) {
            reject(requestId, "浏览器标签页已关闭");
            return;
        }
        String probe = "(function(){var results=window.__rengeAndroidBrowserResults||{};var value=results["
                + JSONObject.quote(resultId) + "];if(!value)return null;delete results["
                + JSONObject.quote(resultId) + "];return value;})()";
        tab.webView.evaluateJavascript(probe, rawValue -> {
            try {
                Object parsed = rawValue == null ? JSONObject.NULL : new JSONTokener(rawValue).nextValue();
                if (parsed == JSONObject.NULL) {
                    if (attempt >= 200) reject(requestId, "页面脚本执行超时");
                    else mainHandler.postDelayed(() -> pollScriptResult(requestId, tab, resultId, attempt + 1), 50);
                    return;
                }
                if (!(parsed instanceof JSONObject)) {
                    reject(requestId, "页面脚本没有返回可识别的执行结果");
                    return;
                }
                JSONObject wrapper = (JSONObject) parsed;
                if (!wrapper.optBoolean("ok", false)) {
                    JSONObject error = wrapper.optJSONObject("error");
                    reject(requestId, error == null ? "页面脚本执行失败" : error.optString("message", "页面脚本执行失败"));
                    return;
                }
                JSONObject payload = new JSONObject();
                payload.put("value", wrapper.has("value") ? wrapper.get("value") : JSONObject.NULL);
                resolve(requestId, payload);
            } catch (Exception error) {
                reject(requestId, error.getMessage());
            }
        });
    }

    private void dispatchInput(BrowserTab tab, JSONObject options) {
        String type = options.optString("type", "");
        if ("keyDown".equals(type) || "keyUp".equals(type)) {
            int action = "keyDown".equals(type) ? KeyEvent.ACTION_DOWN : KeyEvent.ACTION_UP;
            int keyCode = resolveKeyCode(options.optString("keyCode", ""));
            if (keyCode == KeyEvent.KEYCODE_UNKNOWN && options.optString("keyCode", "").length() == 1) {
                keyCode = KeyEvent.keyCodeFromString("KEYCODE_" + options.optString("keyCode", "").toUpperCase(Locale.US));
            }
            int metaState = 0;
            JSONArray modifiers = options.optJSONArray("modifiers");
            if (modifiers != null) {
                for (int index = 0; index < modifiers.length(); index += 1) {
                    String modifier = modifiers.optString(index, "").toLowerCase(Locale.US);
                    if ("alt".equals(modifier)) metaState |= KeyEvent.META_ALT_ON;
                    else if ("control".equals(modifier)) metaState |= KeyEvent.META_CTRL_ON;
                    else if ("meta".equals(modifier)) metaState |= KeyEvent.META_META_ON;
                    else if ("shift".equals(modifier)) metaState |= KeyEvent.META_SHIFT_ON;
                }
            }
            long now = SystemClock.uptimeMillis();
            tab.webView.dispatchKeyEvent(new KeyEvent(
                    now,
                    now,
                    action,
                    keyCode,
                    0,
                    metaState
            ));
            return;
        }
        int action;
        if ("mouseDown".equals(type)) action = MotionEvent.ACTION_DOWN;
        else if ("mouseUp".equals(type)) action = MotionEvent.ACTION_UP;
        else action = MotionEvent.ACTION_MOVE;
        float density = activity.getResources().getDisplayMetrics().density;
        float x = (float) options.optDouble("x", 0) * Math.max(1f, density);
        float y = (float) options.optDouble("y", 0) * Math.max(1f, density);
        long now = SystemClock.uptimeMillis();
        if ("mouseMove".equals(type) && tab.inputDownTime == 0) {
            MotionEvent hoverEvent = MotionEvent.obtain(
                    now,
                    now,
                    MotionEvent.ACTION_HOVER_MOVE,
                    x,
                    y,
                    0
            );
            hoverEvent.setSource(InputDevice.SOURCE_MOUSE);
            tab.webView.dispatchGenericMotionEvent(hoverEvent);
            hoverEvent.recycle();
            return;
        }
        if (action == MotionEvent.ACTION_DOWN) tab.inputDownTime = now;
        long downTime = tab.inputDownTime > 0 ? tab.inputDownTime : now;
        MotionEvent event = MotionEvent.obtain(downTime, now, action, x, y, 0);
        tab.webView.dispatchTouchEvent(event);
        event.recycle();
        if (action == MotionEvent.ACTION_UP) tab.inputDownTime = 0;
    }

    private int resolveKeyCode(String rawKey) {
        String key = rawKey == null ? "" : rawKey.trim();
        switch (key.toLowerCase(Locale.US)) {
            case "arrowup": return KeyEvent.KEYCODE_DPAD_UP;
            case "arrowdown": return KeyEvent.KEYCODE_DPAD_DOWN;
            case "arrowleft": return KeyEvent.KEYCODE_DPAD_LEFT;
            case "arrowright": return KeyEvent.KEYCODE_DPAD_RIGHT;
            case "escape": return KeyEvent.KEYCODE_ESCAPE;
            case "enter": return KeyEvent.KEYCODE_ENTER;
            case "tab": return KeyEvent.KEYCODE_TAB;
            case "backspace": return KeyEvent.KEYCODE_DEL;
            case "delete": return KeyEvent.KEYCODE_FORWARD_DEL;
            case "space": case " ": return KeyEvent.KEYCODE_SPACE;
            default:
                return KeyEvent.keyCodeFromString("KEYCODE_" + key.toUpperCase(Locale.US));
        }
    }

    private void showContextMenu(BrowserTab tab) {
        float density = activity.getResources().getDisplayMetrics().density;
        float cssX = tab.lastTouchX / Math.max(1f, density);
        float cssY = tab.lastTouchY / Math.max(1f, density);
        String script = contextProbeScript(cssX, cssY);
        tab.webView.evaluateJavascript(script, rawValue -> {
            try {
                Object parsed = rawValue == null ? JSONObject.NULL : new JSONTokener(rawValue).nextValue();
                JSONObject target = parsed instanceof JSONObject ? (JSONObject) parsed : new JSONObject();
                JSONObject payload = event("context-menu", tab);
                payload.put("x", cssX);
                payload.put("y", cssY);
                payload.put("hostX", (left + tab.lastTouchX) / Math.max(1f, density));
                payload.put("hostY", (top + tab.lastTouchY) / Math.max(1f, density));
                payload.put("target", target);
                payload.put("selectionText", target.optString("selectionText", ""));
                payload.put("linkUrl", target.optString("linkUrl", ""));
                payload.put("sourceUrl", target.optString("imageUrl", ""));
                try {
                    payload.put("pageScreenshotDataUrl", capture(tab, null).optString("dataUrl", ""));
                } catch (Exception ignored) {
                }
                suspended = true;
                tab.webView.setVisibility(View.GONE);
                dispatchEvent(payload);
            } catch (Exception error) {
                if (visible && tab.id.equals(activeTabId)) tab.webView.setVisibility(View.VISIBLE);
                Toast.makeText(activity, "无法读取网页菜单目标", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private String contextProbeScript(float x, float y) {
        return "(function(){var target=document.elementFromPoint(" + x + "," + y + ");if(!target)return null;"
                + "function esc(value){return globalThis.CSS&&CSS.escape?CSS.escape(String(value)):String(value).replace(/[^a-zA-Z0-9_-]/g,function(char){return '\\\\'+char;});}"
                + "function selector(el){if(el.id)return '#'+esc(el.id);var parts=[];for(var node=el;node&&node.nodeType===1&&parts.length<6;node=node.parentElement){var part=node.tagName.toLowerCase();if(node.classList.length)part+='.'+Array.from(node.classList).slice(0,2).map(esc).join('.');parts.unshift(part);}return parts.join(' > ');}"
                + "function path(el){var parts=[];for(var node=el;node&&node.nodeType===1&&parts.length<8;node=node.parentElement)parts.unshift(node.tagName.toLowerCase());return parts.join(' > ');}"
                + "var rect=target.getBoundingClientRect();var link=target.closest('a[href]');var image=target.tagName==='IMG'?target:(target.closest('picture')&&target.closest('picture').querySelector('img'))||target.closest('img');"
                + "return {pageUrl:location.href,pageTitle:document.title,tagName:target.tagName.toLowerCase(),selector:selector(target),path:path(target),text:(target.innerText||target.textContent||'').trim().slice(0,500),ariaLabel:target.getAttribute('aria-label')||'',nearbyText:(target.parentElement&&target.parentElement.innerText||'').trim().slice(0,1000),outerHtml:target.outerHTML.slice(0,4000),imageUrl:image&&image.currentSrc||image&&image.src||'',linkUrl:link&&link.href||'',selectionText:String(getSelection()||''),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};})()";
    }

    private JSONObject capture(BrowserTab tab, JSONObject rect) throws Exception {
        WebView browser = tab.webView;
        int bitmapWidth = Math.max(1, browser.getWidth());
        int bitmapHeight = Math.max(1, browser.getHeight());
        Bitmap bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        browser.draw(canvas);
        if (rect != null) {
            float density = activity.getResources().getDisplayMetrics().density;
            int cropX = Math.max(0, Math.round((float) rect.optDouble("x", 0) * density));
            int cropY = Math.max(0, Math.round((float) rect.optDouble("y", 0) * density));
            int cropWidth = Math.min(bitmap.getWidth() - cropX, Math.max(1, Math.round((float) rect.optDouble("width", 1) * density)));
            int cropHeight = Math.min(bitmap.getHeight() - cropY, Math.max(1, Math.round((float) rect.optDouble("height", 1) * density)));
            if (cropWidth > 0 && cropHeight > 0) {
                Bitmap cropped = Bitmap.createBitmap(bitmap, cropX, cropY, cropWidth, cropHeight);
                bitmap.recycle();
                bitmap = cropped;
            }
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        bitmap.recycle();
        JSONObject payload = new JSONObject();
        payload.put("ok", true);
        payload.put("dataUrl", "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
        return payload;
    }

    private void enqueueDownload(String url, String contentDisposition, String mimeType, String userAgent) {
        try {
            Uri uri = Uri.parse(requireHttpUrl(url));
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle(fileName);
            request.setMimeType(mimeType == null ? "application/octet-stream" : mimeType);
            if (userAgent != null && !userAgent.trim().isEmpty()) {
                request.addRequestHeader("User-Agent", userAgent);
            }
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.trim().isEmpty()) {
                request.addRequestHeader("Cookie", cookies);
            }
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("系统下载管理器不可用");
            long id = manager.enqueue(request);
            downloads.put(id, new BrowserDownload(id, fileName, url, System.currentTimeMillis()));
            dispatchDownloads();
            Toast.makeText(activity, "已开始下载：" + fileName, Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(activity, "下载失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void runDownloadAction(JSONObject options) {
        long id = options.optLong("id", -1);
        String action = options.optString("action", "");
        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if ("open-folder".equals(action)) {
            activity.startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS));
        } else if ("cancel".equals(action) && manager != null && id >= 0) {
            manager.remove(id);
            downloads.remove(id);
            dispatchDownloads();
        } else if ("remove".equals(action) && id >= 0) {
            downloads.remove(id);
            dispatchDownloads();
        } else if ("clear-completed".equals(action)) {
            Iterator<Map.Entry<Long, BrowserDownload>> iterator = downloads.entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<Long, BrowserDownload> entry = iterator.next();
                if (getDownloadStatus(manager, entry.getKey()) == DownloadManager.STATUS_SUCCESSFUL) {
                    iterator.remove();
                }
            }
            dispatchDownloads();
        } else if ("open".equals(action) && id >= 0) {
            openDownload(manager, id);
        } else if ("reveal".equals(action) && id >= 0) {
            activity.startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS));
        } else if ("pause".equals(action) || "resume".equals(action)) {
            Toast.makeText(activity, "Android 下载由系统下载管理器控制", Toast.LENGTH_SHORT).show();
        }
    }

    private int getDownloadStatus(DownloadManager manager, long id) {
        if (manager == null) return -1;
        try (android.database.Cursor cursor = manager.query(
                new DownloadManager.Query().setFilterById(id))) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            }
        } catch (Exception ignored) {
        }
        return -1;
    }

    private void openDownload(DownloadManager manager, long id) {
        if (manager == null) return;
        Uri uri = manager.getUriForDownloadedFile(id);
        if (uri == null) {
            Toast.makeText(activity, "下载尚未完成或文件已被移动", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, manager.getMimeTypeForDownloadedFile(id));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
        } catch (Exception error) {
            Toast.makeText(activity, "没有可打开此文件的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private JSONObject downloadsPayload() throws JSONException {
        JSONArray items = new JSONArray();
        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        for (BrowserDownload download : downloads.values()) {
            JSONObject item = download.toJson();
            if (manager != null) {
                try (android.database.Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(download.id))) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long received = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        item.put("receivedBytes", Math.max(0, received));
                        item.put("totalBytes", Math.max(0, total));
                        item.put("paused", status == DownloadManager.STATUS_PAUSED);
                        item.put("updatedAt", System.currentTimeMillis());
                        int localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                        if (localUriIndex >= 0) item.put("filePath", cursor.getString(localUriIndex));
                        int mimeTypeIndex = cursor.getColumnIndex(DownloadManager.COLUMN_MEDIA_TYPE);
                        if (mimeTypeIndex >= 0) item.put("mimeType", cursor.getString(mimeTypeIndex));
                        item.put("state", status == DownloadManager.STATUS_SUCCESSFUL
                                ? "completed"
                                : status == DownloadManager.STATUS_FAILED ? "interrupted" : "progressing");
                    }
                } catch (Exception ignored) {
                }
            }
            items.put(item);
        }
        JSONObject payload = new JSONObject();
        payload.put("items", items);
        return payload;
    }

    private void dispatchDownloads() {
        try {
            JSONObject payload = downloadsPayload();
            payload.put("type", "downloads");
            dispatchEvent(payload);
        } catch (Exception ignored) {
        }
    }

    private JSONObject profilePayload() throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("downloadDirectory", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).getAbsolutePath());
        payload.put("passwordCount", 0);
        payload.put("cookieCount", 0);
        payload.put("autofillPasswords", false);
        return payload;
    }

    private void clearData(String action) {
        if ("cache".equals(action) || "all".equals(action)) {
            for (BrowserTab tab : tabs.values()) tab.webView.clearCache(true);
        }
        if ("cookies".equals(action) || "all".equals(action)) {
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().flush();
            for (BrowserTab tab : tabs.values()) {
                tab.webView.clearFormData();
                tab.webView.clearSslPreferences();
            }
        }
        if ("history".equals(action) || "all".equals(action)) {
            for (BrowserTab tab : tabs.values()) tab.webView.clearHistory();
        }
    }

    private void setDesktopMode(BrowserTab tab, boolean enabled) {
        if (enabled) {
            tab.webView.getSettings().setUserAgentString(tab.defaultUserAgent.replace("Mobile", "").replace("Android", "Linux"));
            tab.webView.getSettings().setUseWideViewPort(true);
            tab.webView.getSettings().setLoadWithOverviewMode(true);
        } else {
            tab.webView.getSettings().setUserAgentString(tab.defaultUserAgent);
        }
        tab.webView.reload();
    }

    private void copyText(String text) {
        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("网页内容", text));
    }

    private void copyImage(String url) {
        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || url == null || url.trim().isEmpty()) return;
        clipboard.setPrimaryClip(ClipData.newHtmlText(
                "网页图片",
                url,
                "<img src=\"" + android.text.Html.escapeHtml(url) + "\">"
        ));
    }

    private void openExternal(String url) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception error) {
            Toast.makeText(activity, "无法打开链接", Toast.LENGTH_SHORT).show();
        }
    }

    private BrowserTab requireTab(String tabId) {
        BrowserTab tab = tabs.get(tabId);
        if (tab == null) throw new IllegalStateException("Android 浏览器标签页尚未准备好");
        return tab;
    }

    private void requireTabId(String tabId) {
        if (tabId == null || tabId.trim().isEmpty()) throw new IllegalArgumentException("浏览器标签页 ID 不能为空");
    }

    private String requireHttpUrl(String rawUrl) {
        String value = rawUrl == null ? "" : rawUrl.trim();
        if ("about:blank".equalsIgnoreCase(value)) return "about:blank";
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException("仅支持 HTTP 或 HTTPS 网页");
        }
        return uri.toString();
    }

    private JSONObject statePayload(BrowserTab tab) {
        JSONObject payload = event("state", tab);
        put(payload, "url", tab.webView.getUrl() == null ? "about:blank" : tab.webView.getUrl());
        put(payload, "title", tab.webView.getTitle() == null ? "新页面" : tab.webView.getTitle());
        put(payload, "canGoBack", tab.webView.canGoBack());
        put(payload, "canGoForward", tab.webView.canGoForward());
        put(payload, "loading", tab.loading);
        put(payload, "visible", visible && tab.id.equals(activeTabId));
        put(payload, "zoomFactor", tab.zoomFactor);
        return payload;
    }

    private void dispatchState(BrowserTab tab) {
        dispatchEvent(statePayload(tab));
    }

    private JSONObject event(String type, BrowserTab tab) {
        JSONObject payload = new JSONObject();
        put(payload, "type", type);
        put(payload, "tabId", tab.id);
        return payload;
    }

    private JSONObject ok(String command) {
        JSONObject payload = new JSONObject();
        put(payload, "ok", true);
        put(payload, "command", command);
        return payload;
    }

    private void dispatchEvent(JSONObject payload) {
        appWebView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(EVENT_NAME) + ",{detail:"
                        + payload.toString() + "}));",
                null
        );
    }

    private void resolve(String requestId, JSONObject payload) {
        appWebView.evaluateJavascript(
                "window." + RESOLVE_NAME + "&&window." + RESOLVE_NAME + "("
                        + JSONObject.quote(requestId) + "," + payload.toString() + ")",
                null
        );
    }

    private void reject(String requestId, String message) {
        appWebView.evaluateJavascript(
                "window." + REJECT_NAME + "&&window." + REJECT_NAME + "("
                        + JSONObject.quote(requestId) + "," + JSONObject.quote(message == null ? "Android 浏览器请求失败" : message) + ")",
                null
        );
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (JSONException ignored) {
        }
    }

    private static final class BrowserTab {
        final String id;
        final WebView webView;
        final String defaultUserAgent;
        boolean loading;
        float zoomFactor = 1f;
        float lastTouchX;
        float lastTouchY;
        long inputDownTime;

        BrowserTab(String id, WebView webView, String defaultUserAgent) {
            this.id = id;
            this.webView = webView;
            this.defaultUserAgent = defaultUserAgent == null ? "" : defaultUserAgent;
        }
    }

    private static final class BrowserDownload {
        final long id;
        final String fileName;
        final String url;
        final long startedAt;

        BrowserDownload(long id, String fileName, String url, long startedAt) {
            this.id = id;
            this.fileName = fileName;
            this.url = url;
            this.startedAt = startedAt;
        }

        JSONObject toJson() {
            JSONObject payload = new JSONObject();
            put(payload, "id", String.valueOf(id));
            put(payload, "nativeId", id);
            put(payload, "fileName", fileName);
            put(payload, "url", url);
            put(payload, "startedAt", startedAt);
            put(payload, "receivedBytes", 0);
            put(payload, "totalBytes", 0);
            put(payload, "state", "progressing");
            put(payload, "paused", false);
            return payload;
        }
    }
}
