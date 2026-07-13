package com.renge.agentlab;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

public class AndroidWorkspaceBridge {
    private static final String PREFS_NAME = "renge_android_workspace";
    private static final String PREF_URI = "uri";
    private static final String PREF_NAME = "name";
    private static final String PREF_ROOT_PATH = "root_path";
    private static final String PREF_ROOT_GRANTED = "root_granted";
    private static final String MIME_DIR = DocumentsContract.Document.MIME_TYPE_DIR;

    private final Activity activity;
    private final WebView webView;
    private final int requestCode;
    private final ContentResolver resolver;
    private final SharedPreferences preferences;

    private String pendingRequestId;
    private Uri treeUri;
    private String workspaceName;
    private boolean rootWorkspace;
    private String rootWorkspacePath;
    private boolean rootAccessGranted;

    AndroidWorkspaceBridge(Activity activity, WebView webView, int requestCode) {
        this.activity = activity;
        this.webView = webView;
        this.requestCode = requestCode;
        this.resolver = activity.getContentResolver();
        this.preferences = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.rootAccessGranted = preferences.getBoolean(PREF_ROOT_GRANTED, false);

        String savedUri = preferences.getString(PREF_URI, "");
        String savedRootPath = preferences.getString(PREF_ROOT_PATH, "");
        if (savedRootPath != null && !savedRootPath.isEmpty()) {
            rootWorkspace = true;
            rootWorkspacePath = savedRootPath;
            workspaceName = "ROOT " + rootWorkspacePath;
        } else if (savedUri != null && !savedUri.isEmpty()) {
            treeUri = Uri.parse(savedUri);
            workspaceName = preferences.getString(PREF_NAME, "手机工作区");
        }
    }

    void injectApi() {
        String script =
                "(function(){"
                        + "if(window.rengeAndroid&&window.rengeAndroid.isAndroid)return;"
                        + "var pending={};"
                        + "window.__rengeAndroidResolve=function(id,payload){if(!pending[id])return;pending[id].resolve(payload);delete pending[id];};"
                        + "window.__rengeAndroidReject=function(id,message){if(!pending[id])return;pending[id].reject(new Error(message||'Android workspace error'));delete pending[id];};"
                        + "function parse(text){var payload=JSON.parse(text);if(payload&&payload.error)throw new Error(payload.error);return payload;}"
                        + "function call(name,options){return Promise.resolve().then(function(){return parse(window.RengeAndroidNative[name](JSON.stringify(options||{})));});}"
                        + "window.rengeAndroid={"
                        + "isAndroid:true,"
                        + "selectWorkspace:function(){return new Promise(function(resolve,reject){var id=String(Date.now())+Math.random().toString(16).slice(2);pending[id]={resolve:resolve,reject:reject};window.RengeAndroidNative.selectWorkspace(id);});},"
                        + "selectRootWorkspace:function(options){return call('selectRootWorkspace',options);},"
                        + "restoreWorkspace:function(options){return call('restoreWorkspace',options);},"
                        + "listFiles:function(options){return call('listFiles',options);},"
                        + "readFile:function(options){return call('readFile',options);},"
                        + "readBinaryFile:function(options){return call('readBinaryFile',options);},"
                        + "readFileRange:function(options){return call('readFileRange',options);},"
                        + "fileInfo:function(options){return call('fileInfo',options);},"
                        + "searchFiles:function(options){return call('searchFiles',options);},"
                        + "createDirectory:function(options){return call('createDirectory',options);},"
                        + "writeFile:function(options){return call('writeFile',options);},"
                        + "writeBinaryFile:function(options){return call('writeBinaryFile',options);},"
                        + "transferFileToPc:function(options){return call('transferFileToPc',options);},"
                        + "transferFileFromPc:function(options){return call('transferFileFromPc',options);},"
                        + "deletePath:function(options){return call('deletePath',options);},"
                        + "requestRootAccess:function(options){return call('requestRootAccess',options);},"
                        + "getRootAccessStatus:function(options){return call('getRootAccessStatus',options);},"
                        + "getWorkspaceStatus:function(options){return call('getWorkspaceStatus',options);}"
                        + "};"
                        + "})();";
        webView.evaluateJavascript(script, null);
    }

    @JavascriptInterface
    public void selectWorkspace(String requestId) {
        activity.runOnUiThread(() -> {
            pendingRequestId = requestId;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            try {
                activity.startActivityForResult(intent, requestCode);
            } catch (Exception error) {
                reject(requestId, error.getMessage());
                pendingRequestId = null;
            }
        });
    }

    void handleActivityResult(int resultCode, Intent data) {
        String requestId = pendingRequestId;
        pendingRequestId = null;
        if (requestId == null) return;

        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            resolveNull(requestId);
            return;
        }

        Uri uri = data.getData();
        int flags = data.getFlags() &
                (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            activity.getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (Exception ignored) {
            // Some providers grant access for the session only.
        }

        treeUri = uri;
        rootWorkspace = false;
        rootWorkspacePath = null;
        try {
            workspaceName = getDisplayName(getRootDocumentId());
        } catch (IOException ignored) {
            workspaceName = null;
        }
        if (workspaceName == null || workspaceName.trim().isEmpty()) {
            workspaceName = "手机工作区";
        }
        preferences.edit()
                .putString(PREF_URI, treeUri.toString())
                .putString(PREF_NAME, workspaceName)
                .remove(PREF_ROOT_PATH)
                .apply();

        JSONObject payload = new JSONObject();
        try {
            payload.put("kind", "android");
            payload.put("name", workspaceName);
            payload.put("uri", treeUri.toString());
        } catch (JSONException ignored) {
        }
        resolve(requestId, payload);
    }

    @JavascriptInterface
    public String selectRootWorkspace(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = normalizeRootWorkspacePath(options.optString("path", "/"));
            RootCommandResult test = runRootCommand("[ -d " + shellQuote(path) + " ] && echo ok || echo missing", 8);
            if (test.exitCode != 0 || !test.stdout.trim().equals("ok")) {
                throw new IOException("ROOT 路径不存在或不是目录：" + path);
            }

            rootWorkspace = true;
            rootWorkspacePath = path;
            treeUri = null;
            workspaceName = "ROOT " + path;
            preferences.edit()
                    .remove(PREF_URI)
                    .putString(PREF_NAME, workspaceName)
                    .putString(PREF_ROOT_PATH, rootWorkspacePath)
                    .apply();

            JSONObject payload = new JSONObject();
            payload.put("kind", "android");
            payload.put("name", workspaceName);
            payload.put("uri", "root:" + rootWorkspacePath);
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String restoreWorkspace(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String uri = options.optString("uri", "").trim();
            if (uri.isEmpty()) throw new IOException("缺少工作区 URI");

            if (uri.startsWith("root:")) {
                String path = normalizeRootWorkspacePath(uri.substring("root:".length()));
                RootCommandResult test = runRootCommand("[ -d " + shellQuote(path) + " ] && echo ok || echo missing", 8);
                if (test.exitCode != 0 || !test.stdout.trim().equals("ok")) {
                    throw new IOException("ROOT 路径不存在或不是目录：" + path);
                }
                rootWorkspace = true;
                rootWorkspacePath = path;
                treeUri = null;
                workspaceName = "ROOT " + path;
                preferences.edit()
                        .remove(PREF_URI)
                        .putString(PREF_NAME, workspaceName)
                        .putString(PREF_ROOT_PATH, rootWorkspacePath)
                        .apply();

                JSONObject payload = new JSONObject();
                payload.put("kind", "android");
                payload.put("name", workspaceName);
                payload.put("uri", "root:" + rootWorkspacePath);
                return payload.toString();
            }

            Uri restoredUri = Uri.parse(uri);
            treeUri = restoredUri;
            rootWorkspace = false;
            rootWorkspacePath = null;
            try {
                workspaceName = getDisplayName(getRootDocumentId());
            } catch (IOException ignored) {
                workspaceName = null;
            }
            if (workspaceName == null || workspaceName.trim().isEmpty()) {
                workspaceName = options.optString("name", "手机工作区");
            }
            preferences.edit()
                    .putString(PREF_URI, treeUri.toString())
                    .putString(PREF_NAME, workspaceName)
                    .remove(PREF_ROOT_PATH)
                    .apply();

            JSONObject payload = new JSONObject();
            payload.put("kind", "android");
            payload.put("name", workspaceName);
            payload.put("uri", treeUri.toString());
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String listFiles(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            boolean recursive = !options.has("recursive") || options.optBoolean("recursive", true);
            if (rootWorkspace) return listRootFiles(path, recursive).toString();
            JSONArray results = new JSONArray();
            String docId = resolveDocumentId(path);
            listFilesInto(docId, normalizePath(path), recursive, results, 240);
            return results.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String readFile(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            if (rootWorkspace) {
                JSONObject payload = new JSONObject();
                payload.put("path", path);
                payload.put("content", new String(readRootBytes(path), StandardCharsets.UTF_8));
                return payload.toString();
            }
            JSONObject payload = new JSONObject();
            payload.put("path", path);
            payload.put("content", readText(resolveDocumentId(path)));
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String readBinaryFile(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            byte[] bytes = rootWorkspace ? readRootBytes(path) : readBytes(resolveDocumentId(path));
            JSONObject payload = new JSONObject();
            payload.put("path", path);
            payload.put("size", bytes.length);
            payload.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String readFileRange(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            int startLine = Math.max(1, options.optInt("startLine", 1));
            int endLine = Math.max(startLine, options.optInt("endLine", startLine + 120));
            String text = rootWorkspace
                    ? new String(readRootBytes(path), StandardCharsets.UTF_8)
                    : readText(resolveDocumentId(path));
            String[] lines = text.replace("\r\n", "\n").split("\n", -1);
            int safeEndLine = Math.min(lines.length, endLine);
            StringBuilder content = new StringBuilder();
            for (int index = startLine - 1; index < safeEndLine; index++) {
                if (content.length() > 0) content.append('\n');
                content.append(lines[index]);
            }
            JSONObject payload = new JSONObject();
            payload.put("path", path);
            payload.put("startLine", startLine);
            payload.put("endLine", safeEndLine);
            payload.put("totalLines", lines.length);
            payload.put("content", content.toString());
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String fileInfo(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            if (rootWorkspace) return rootFileInfo(path).toString();
            DocumentEntry entry = getEntry(resolveDocumentId(path));
            JSONObject payload = new JSONObject();
            payload.put("path", path);
            payload.put("kind", entry.isDirectory() ? "directory" : "file");
            payload.put("name", entry.name);
            if (!entry.isDirectory()) {
                payload.put("size", entry.size);
                payload.put("modifiedAt", entry.modifiedAt > 0 ? new java.util.Date(entry.modifiedAt).toInstant().toString() : JSONObject.NULL);
            }
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String searchFiles(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String query = options.optString("query", "").toLowerCase(Locale.US).trim();
            if (query.isEmpty()) throw new IOException("query 不能为空");
            String path = options.optString("path", "");
            if (rootWorkspace) return searchRootFiles(query, path).toString();
            boolean includeContent = !options.has("includeContent") || options.optBoolean("includeContent", true);
            JSONArray results = new JSONArray();
            List<DocumentEntry> files = new ArrayList<>();
            collectFiles(resolveDocumentId(path), normalizePath(path), files, 320);
            for (DocumentEntry file : files) {
                if (results.length() >= 80) break;
                String lowerPath = file.path.toLowerCase(Locale.US);
                if (lowerPath.contains(query)) {
                    JSONObject match = new JSONObject();
                    match.put("path", file.path);
                    match.put("match", "name");
                    results.put(match);
                    continue;
                }
                if (!includeContent || file.size > 1024 * 1024 || !isLikelyText(file.name)) continue;
                try {
                    String content = readText(file.documentId);
                    int index = content.toLowerCase(Locale.US).indexOf(query);
                    if (index >= 0) {
                        JSONObject match = new JSONObject();
                        match.put("path", file.path);
                        match.put("match", "content");
                        match.put("preview", content.substring(Math.max(0, index - 60), Math.min(content.length(), index + query.length() + 120)));
                        results.put(match);
                    }
                } catch (Exception ignored) {
                }
            }
            return results.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String createDirectory(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            if (rootWorkspace) {
                String absolutePath = resolveRootPath(path);
                RootCommandResult result = runRootCommand("mkdir -p " + shellQuote(absolutePath), 15);
                if (result.exitCode != 0) throw new IOException(rootErrorMessage(result, "ROOT 创建目录失败"));
                JSONObject payload = new JSONObject();
                payload.put("ok", true);
                payload.put("path", path);
                payload.put("operation", "mkdir");
                return payload.toString();
            }
            resolveDirectoryId(path, true);
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("path", path);
            payload.put("operation", "mkdir");
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String writeFile(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            String content = options.optString("content", "");
            if (rootWorkspace) return writeRootBytes(path, content.getBytes(StandardCharsets.UTF_8), "write");
            String documentId = resolveFileForWrite(path);
            Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
            try (OutputStream output = resolver.openOutputStream(documentUri, "wt")) {
                if (output == null) throw new IOException("无法写入文件");
                output.write(content.getBytes(StandardCharsets.UTF_8));
            }
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("path", path);
            payload.put("operation", "write");
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String writeBinaryFile(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            String base64 = options.optString("base64", "")
                    .replaceFirst("^data:[^,]*,", "")
                    .replaceAll("\\s+", "");
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (rootWorkspace) return writeRootBytes(path, bytes, "writeBinary");
            String documentId = resolveFileForWrite(path);
            Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
            try (OutputStream output = resolver.openOutputStream(documentUri, "wt")) {
                if (output == null) throw new IOException("无法写入文件");
                output.write(bytes);
            }
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("path", path);
            payload.put("operation", "writeBinary");
            payload.put("bytes", bytes.length);
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String transferFileToPc(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String sourcePath = options.optString("sourcePath", "");
            String targetPath = options.optString("targetPath", "");
            String pcBaseUrl = options.optString("pcBaseUrl", "");
            String pcWorkspacePath = options.optString("pcWorkspacePath", "");
            if (rootWorkspace) return transferRootFileToPc(sourcePath, targetPath, pcBaseUrl, pcWorkspacePath);
            String sourceDocumentId = resolveDocumentId(sourcePath);
            Uri sourceUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, sourceDocumentId);
            URL url = new URL(buildPcTransferUrl(pcBaseUrl, "/api/pc/upload-file", pcWorkspacePath, targetPath));
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("PUT");
            connection.setDoOutput(true);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(0);
            connection.setChunkedStreamingMode(1024 * 1024);

            long bytes = 0;
            try (
                    InputStream input = resolver.openInputStream(sourceUri);
                    OutputStream output = connection.getOutputStream()
            ) {
                if (input == null) throw new IOException("无法读取源文件");
                bytes = copyStream(input, output);
            }

            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException(readConnectionError(connection, "电脑接收文件失败：" + code));
            }

            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("direction", "phone_to_pc");
            payload.put("sourcePath", sourcePath);
            payload.put("targetPath", targetPath);
            payload.put("bytes", bytes);
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String transferFileFromPc(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String sourcePath = options.optString("sourcePath", "");
            String targetPath = options.optString("targetPath", "");
            String pcBaseUrl = options.optString("pcBaseUrl", "");
            String pcWorkspacePath = options.optString("pcWorkspacePath", "");
            if (rootWorkspace) return transferRootFileFromPc(sourcePath, targetPath, pcBaseUrl, pcWorkspacePath);
            String targetDocumentId = resolveFileForWrite(targetPath);
            Uri targetUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, targetDocumentId);
            URL url = new URL(buildPcTransferUrl(pcBaseUrl, "/api/pc/download-file", pcWorkspacePath, sourcePath));
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(0);

            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException(readConnectionError(connection, "电脑发送文件失败：" + code));
            }

            long bytes;
            try (
                    InputStream input = connection.getInputStream();
                    OutputStream output = resolver.openOutputStream(targetUri, "wt")
            ) {
                if (output == null) throw new IOException("无法写入目标文件");
                bytes = copyStream(input, output);
            }

            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("direction", "pc_to_phone");
            payload.put("sourcePath", sourcePath);
            payload.put("targetPath", targetPath);
            payload.put("bytes", bytes);
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String deletePath(String optionsJson) {
        try {
            JSONObject options = parseOptions(optionsJson);
            String path = options.optString("path", "");
            boolean recursive = options.optBoolean("recursive", false);
            if (rootWorkspace) {
                String absolutePath = resolveRootPath(path);
                String command = recursive
                        ? "rm -rf " + shellQuote(absolutePath)
                        : "rm -f " + shellQuote(absolutePath);
                RootCommandResult result = runRootCommand(command, 20);
                if (result.exitCode != 0) throw new IOException(rootErrorMessage(result, "ROOT 删除失败"));
                JSONObject payload = new JSONObject();
                payload.put("ok", true);
                payload.put("path", path);
                payload.put("operation", "delete");
                return payload.toString();
            }
            String documentId = resolveDocumentId(path);
            DocumentEntry entry = getEntry(documentId);
            if (entry.isDirectory() && recursive) {
                deleteChildren(documentId);
            }
            DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId));
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("path", path);
            payload.put("operation", "delete");
            return payload.toString();
        } catch (Exception error) {
            return errorJson(error);
        }
    }

    @JavascriptInterface
    public String requestRootAccess(String optionsJson) {
        Process process = null;
        try {
            JSONObject options = parseOptions(optionsJson);
            int timeoutSeconds = Math.max(3, Math.min(30, options.optInt("timeoutSeconds", 12)));
            process = Runtime.getRuntime().exec(new String[]{"su", "-c", "id"});
            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                rootAccessGranted = false;
                preferences.edit().putBoolean(PREF_ROOT_GRANTED, false).apply();
                JSONObject payload = new JSONObject();
                payload.put("granted", false);
                payload.put("persisted", false);
                payload.put("timedOut", true);
                payload.put("message", "ROOT 授权超时，请确认授权弹窗是否被系统拦截。");
                return payload.toString();
            }

            int exitCode = process.exitValue();
            String stdout = readStreamText(process.getInputStream()).trim();
            String stderr = readStreamText(process.getErrorStream()).trim();
            boolean granted = exitCode == 0 && stdout.contains("uid=0");
            rootAccessGranted = granted;
            preferences.edit().putBoolean(PREF_ROOT_GRANTED, granted).apply();

            JSONObject payload = new JSONObject();
            payload.put("granted", granted);
            payload.put("persisted", granted);
            payload.put("exitCode", exitCode);
            payload.put("output", stdout);
            payload.put("errorOutput", stderr);
            payload.put(
                    "message",
                    granted
                            ? "ROOT 权限已授予。"
                            : (stderr.isEmpty() ? "ROOT 权限未授予或设备未 ROOT。" : stderr)
            );
            return payload.toString();
        } catch (Exception error) {
            rootAccessGranted = false;
            preferences.edit().putBoolean(PREF_ROOT_GRANTED, false).apply();
            JSONObject payload = new JSONObject();
            try {
                payload.put("granted", false);
                payload.put("persisted", false);
                payload.put("message", error.getMessage() == null ? "ROOT 权限请求失败。" : error.getMessage());
                return payload.toString();
            } catch (JSONException ignored) {
                return "{\"granted\":false,\"message\":\"ROOT 权限请求失败。\"}";
            }
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    @JavascriptInterface
    public String getRootAccessStatus(String optionsJson) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("granted", rootAccessGranted);
            payload.put("persisted", rootAccessGranted);
            payload.put(
                    "message",
                    rootAccessGranted
                            ? "ROOT 权限已授权。"
                            : "ROOT 权限未授权。"
            );
        } catch (JSONException ignored) {
        }
        return payload.toString();
    }

    @JavascriptInterface
    public String getWorkspaceStatus(String optionsJson) {
        JSONObject payload = new JSONObject();
        try {
            if (rootWorkspace && rootWorkspacePath != null && !rootWorkspacePath.trim().isEmpty()) {
                payload.put("available", true);
                payload.put("kind", "android");
                payload.put("name", workspaceName == null || workspaceName.trim().isEmpty() ? "ROOT " + rootWorkspacePath : workspaceName);
                payload.put("uri", "root:" + rootWorkspacePath);
                payload.put("root", true);
                payload.put("path", rootWorkspacePath);
                return payload.toString();
            }

            if (treeUri != null) {
                payload.put("available", true);
                payload.put("kind", "android");
                payload.put("name", workspaceName == null || workspaceName.trim().isEmpty() ? "手机工作区" : workspaceName);
                payload.put("uri", treeUri.toString());
                payload.put("root", false);
                return payload.toString();
            }

            payload.put("available", false);
            payload.put("message", "没有已保存的 Android 工作区。");
        } catch (JSONException ignored) {
        }
        return payload.toString();
    }

    private void resolve(String requestId, JSONObject payload) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(
                "window.__rengeAndroidResolve && window.__rengeAndroidResolve(" + quote(requestId) + "," + payload.toString() + ")",
                null
        ));
    }

    private void resolveNull(String requestId) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(
                "window.__rengeAndroidResolve && window.__rengeAndroidResolve(" + quote(requestId) + ",null)",
                null
        ));
    }

    private void reject(String requestId, String message) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(
                "window.__rengeAndroidReject && window.__rengeAndroidReject(" + quote(requestId) + "," + quote(message == null ? "工作区授权失败" : message) + ")",
                null
        ));
    }

    private String quote(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }

    private JSONObject parseOptions(String optionsJson) throws JSONException {
        return optionsJson == null || optionsJson.trim().isEmpty()
                ? new JSONObject()
                : new JSONObject(optionsJson);
    }

    private void requireWorkspace() throws IOException {
        if (treeUri == null) throw new IOException("请先选择手机工作区文件夹");
    }

    private void requireRootWorkspace() throws IOException {
        if (!rootWorkspace || rootWorkspacePath == null || rootWorkspacePath.trim().isEmpty()) {
            throw new IOException("请先设置 ROOT 工作区");
        }
    }

    private String normalizeRootWorkspacePath(String path) throws IOException {
        String normalized = path == null || path.trim().isEmpty() ? "/" : path.trim().replace('\\', '/');
        normalized = normalized.replaceAll("/+$", "");
        if (normalized.isEmpty()) normalized = "/";
        if (!normalized.startsWith("/")) throw new IOException("ROOT 工作区必须是绝对路径");
        for (String part : normalized.split("/")) {
            if (".".equals(part) || "..".equals(part)) {
                throw new IOException("路径不能包含 . 或 ..");
            }
        }
        return normalized;
    }

    private String resolveRootPath(String relativePath) throws IOException {
        requireRootWorkspace();
        String normalized = normalizePath(relativePath);
        if (normalized.isEmpty()) return rootWorkspacePath;
        if ("/".equals(rootWorkspacePath)) return "/" + normalized;
        return rootWorkspacePath + "/" + normalized;
    }

    private String shellQuote(String value) {
        return "'" + (value == null ? "" : value).replace("'", "'\"'\"'") + "'";
    }

    private String rootErrorMessage(RootCommandResult result, String fallback) {
        String stderr = result.stderr == null ? "" : result.stderr.trim();
        String stdout = result.stdout == null ? "" : result.stdout.trim();
        if (!stderr.isEmpty()) return fallback + "：" + stderr;
        if (!stdout.isEmpty()) return fallback + "：" + stdout;
        return fallback + "，退出码 " + result.exitCode;
    }

    private RootCommandResult runRootCommand(String command, int timeoutSeconds) throws IOException, InterruptedException {
        Process process = Runtime.getRuntime().exec(new String[]{"su", "-c", command});
        boolean finished = process.waitFor(Math.max(3, timeoutSeconds), TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("ROOT 命令执行超时");
        }
        return new RootCommandResult(
                process.exitValue(),
                readStreamText(process.getInputStream()),
                readStreamText(process.getErrorStream())
        );
    }

    private byte[] runRootCommandBytes(String command, int timeoutSeconds) throws IOException, InterruptedException {
        Process process = Runtime.getRuntime().exec(new String[]{"su", "-c", command});
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = process.getInputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
        }
        boolean finished = process.waitFor(Math.max(3, timeoutSeconds), TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("ROOT 命令执行超时");
        }
        if (process.exitValue() != 0) {
            String error = readStreamText(process.getErrorStream()).trim();
            throw new IOException(error.isEmpty() ? "ROOT 读取失败，退出码 " + process.exitValue() : error);
        }
        return output.toByteArray();
    }

    private JSONArray listRootFiles(String path, boolean recursive) throws IOException, InterruptedException, JSONException {
        String absolutePath = resolveRootPath(path);
        String command = "find " + shellQuote(absolutePath) + " -mindepth 1 "
                + (recursive ? "" : "-maxdepth 1 ")
                + "-exec sh -c 'for p do if [ -d \"$p\" ]; then t=directory; else t=file; fi; printf \"%s\\t%s\\n\" \"$t\" \"$p\"; done' sh {} + 2>/dev/null | head -n 240";
        RootCommandResult result = runRootCommand(command, 30);
        if (result.exitCode != 0) throw new IOException(rootErrorMessage(result, "ROOT 列目录失败"));
        JSONArray items = new JSONArray();
        String prefix = absolutePath.endsWith("/") ? absolutePath : absolutePath + "/";
        for (String line : result.stdout.split("\\r?\\n")) {
            if (line.trim().isEmpty()) continue;
            String[] parts = line.split("\\t", 2);
            if (parts.length < 2) continue;
            String fullPath = parts[1];
            String relative = fullPath.startsWith(prefix) ? fullPath.substring(prefix.length()) : fullPath.replaceFirst("^/+", "");
            JSONObject item = new JSONObject();
            item.put("path", relative);
            item.put("kind", "directory".equals(parts[0]) ? "directory" : "file");
            items.put(item);
        }
        return items;
    }

    private byte[] readRootBytes(String path) throws IOException, InterruptedException {
        String absolutePath = resolveRootPath(path);
        return runRootCommandBytes("cat " + shellQuote(absolutePath), 60);
    }

    private JSONObject rootFileInfo(String path) throws IOException, InterruptedException, JSONException {
        String absolutePath = resolveRootPath(path);
        String command = "if [ -d " + shellQuote(absolutePath) + " ]; then echo directory; elif [ -f " + shellQuote(absolutePath) + " ]; then echo file; else echo missing; fi";
        RootCommandResult result = runRootCommand(command, 10);
        if (result.exitCode != 0) throw new IOException(rootErrorMessage(result, "ROOT 查看路径失败"));
        String kind = result.stdout.trim();
        if ("missing".equals(kind) || kind.isEmpty()) throw new IOException("路径不存在：" + path);
        JSONObject payload = new JSONObject();
        payload.put("path", path);
        payload.put("kind", kind);
        payload.put("name", absolutePath.equals("/") ? "/" : absolutePath.substring(absolutePath.lastIndexOf('/') + 1));
        if ("file".equals(kind)) {
            RootCommandResult sizeResult = runRootCommand("wc -c < " + shellQuote(absolutePath), 10);
            if (sizeResult.exitCode == 0) {
                try {
                    payload.put("size", Long.parseLong(sizeResult.stdout.trim()));
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return payload;
    }

    private JSONArray searchRootFiles(String query, String path) throws IOException, InterruptedException, JSONException {
        String absolutePath = resolveRootPath(path);
        RootCommandResult result = runRootCommand("find " + shellQuote(absolutePath) + " -type f 2>/dev/null | head -n 320", 30);
        if (result.exitCode != 0) throw new IOException(rootErrorMessage(result, "ROOT 搜索失败"));
        JSONArray matches = new JSONArray();
        String lowerQuery = query.toLowerCase(Locale.US);
        String prefix = absolutePath.endsWith("/") ? absolutePath : absolutePath + "/";
        for (String fullPath : result.stdout.split("\\r?\\n")) {
            if (matches.length() >= 80) break;
            if (fullPath.trim().isEmpty()) continue;
            String relative = fullPath.startsWith(prefix) ? fullPath.substring(prefix.length()) : fullPath.replaceFirst("^/+", "");
            if (!relative.toLowerCase(Locale.US).contains(lowerQuery)) continue;
            JSONObject match = new JSONObject();
            match.put("path", relative);
            match.put("match", "name");
            matches.put(match);
        }
        return matches;
    }

    private String writeRootBytes(String path, byte[] bytes, String operation) throws IOException, InterruptedException, JSONException {
        String absolutePath = resolveRootPath(path);
        int slashIndex = absolutePath.lastIndexOf('/');
        String parentPath = slashIndex <= 0 ? "/" : absolutePath.substring(0, slashIndex);
        Process process = Runtime.getRuntime().exec(new String[]{"su", "-c", "mkdir -p " + shellQuote(parentPath) + " && cat > " + shellQuote(absolutePath)});
        try (OutputStream output = process.getOutputStream()) {
            output.write(bytes);
            output.flush();
        }
        boolean finished = process.waitFor(60, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("ROOT 写入超时");
        }
        if (process.exitValue() != 0) {
            throw new IOException(readStreamText(process.getErrorStream()).trim());
        }
        JSONObject payload = new JSONObject();
        payload.put("ok", true);
        payload.put("path", path);
        payload.put("operation", operation);
        payload.put("bytes", bytes.length);
        return payload.toString();
    }

    private String transferRootFileToPc(String sourcePath, String targetPath, String pcBaseUrl, String pcWorkspacePath) throws IOException, InterruptedException, JSONException {
        String absolutePath = resolveRootPath(sourcePath);
        URL url = new URL(buildPcTransferUrl(pcBaseUrl, "/api/pc/upload-file", pcWorkspacePath, targetPath));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("PUT");
        connection.setDoOutput(true);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(0);
        connection.setChunkedStreamingMode(1024 * 1024);

        Process process = Runtime.getRuntime().exec(new String[]{"su", "-c", "cat " + shellQuote(absolutePath)});
        long bytes;
        try (
                InputStream input = process.getInputStream();
                OutputStream output = connection.getOutputStream()
        ) {
            bytes = copyStream(input, output);
        }
        boolean finished = process.waitFor(60, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("ROOT 读取源文件超时");
        }
        if (process.exitValue() != 0) {
            throw new IOException(readStreamText(process.getErrorStream()).trim());
        }

        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IOException(readConnectionError(connection, "电脑接收文件失败：" + code));
        }

        JSONObject payload = new JSONObject();
        payload.put("ok", true);
        payload.put("direction", "phone_to_pc");
        payload.put("sourcePath", sourcePath);
        payload.put("targetPath", targetPath);
        payload.put("bytes", bytes);
        return payload.toString();
    }

    private String transferRootFileFromPc(String sourcePath, String targetPath, String pcBaseUrl, String pcWorkspacePath) throws IOException, InterruptedException, JSONException {
        String absolutePath = resolveRootPath(targetPath);
        int slashIndex = absolutePath.lastIndexOf('/');
        String parentPath = slashIndex <= 0 ? "/" : absolutePath.substring(0, slashIndex);
        RootCommandResult mkdir = runRootCommand("mkdir -p " + shellQuote(parentPath), 15);
        if (mkdir.exitCode != 0) throw new IOException(rootErrorMessage(mkdir, "ROOT 创建目标目录失败"));

        URL url = new URL(buildPcTransferUrl(pcBaseUrl, "/api/pc/download-file", pcWorkspacePath, sourcePath));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(0);

        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IOException(readConnectionError(connection, "电脑发送文件失败：" + code));
        }

        Process process = Runtime.getRuntime().exec(new String[]{"su", "-c", "cat > " + shellQuote(absolutePath)});
        long bytes;
        try (
                InputStream input = connection.getInputStream();
                OutputStream output = process.getOutputStream()
        ) {
            bytes = copyStream(input, output);
        }
        boolean finished = process.waitFor(60, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("ROOT 写入目标文件超时");
        }
        if (process.exitValue() != 0) {
            throw new IOException(readStreamText(process.getErrorStream()).trim());
        }

        JSONObject payload = new JSONObject();
        payload.put("ok", true);
        payload.put("direction", "pc_to_phone");
        payload.put("sourcePath", sourcePath);
        payload.put("targetPath", targetPath);
        payload.put("bytes", bytes);
        return payload.toString();
    }

    private String getRootDocumentId() throws IOException {
        requireWorkspace();
        return DocumentsContract.getTreeDocumentId(treeUri);
    }

    private String normalizePath(String path) throws IOException {
        String normalized = (path == null ? "" : path).replace('\\', '/').replaceAll("^/+", "").replaceAll("/+$", "");
        for (String part : normalized.split("/")) {
            if (".".equals(part) || "..".equals(part)) {
                throw new IOException("路径不能包含 . 或 ..");
            }
        }
        return normalized;
    }

    private String resolveDocumentId(String path) throws IOException {
        String normalized = normalizePath(path);
        if (normalized.isEmpty()) return getRootDocumentId();
        String current = getRootDocumentId();
        for (String part : normalized.split("/")) {
            current = findChild(current, part);
            if (current == null) throw new IOException("路径不存在：" + normalized);
        }
        return current;
    }

    private String resolveDirectoryId(String path, boolean create) throws IOException {
        String normalized = normalizePath(path);
        if (normalized.isEmpty()) return getRootDocumentId();
        String current = getRootDocumentId();
        for (String part : normalized.split("/")) {
            String next = findChild(current, part);
            if (next == null && create) {
                Uri created = DocumentsContract.createDocument(
                        resolver,
                        DocumentsContract.buildDocumentUriUsingTree(treeUri, current),
                        MIME_DIR,
                        part
                );
                if (created == null) throw new IOException("无法创建目录：" + part);
                next = DocumentsContract.getDocumentId(created);
            }
            if (next == null) throw new IOException("目录不存在：" + normalized);
            current = next;
        }
        return current;
    }

    private String resolveFileForWrite(String path) throws IOException {
        String normalized = normalizePath(path);
        String[] parts = normalized.split("/");
        if (parts.length == 0 || parts[0].isEmpty()) throw new IOException("缺少文件路径");
        String name = parts[parts.length - 1];
        StringBuilder parentPath = new StringBuilder();
        for (int i = 0; i < parts.length - 1; i++) {
            if (i > 0) parentPath.append('/');
            parentPath.append(parts[i]);
        }
        String parentId = resolveDirectoryId(parentPath.toString(), true);
        String existing = findChild(parentId, name);
        if (existing != null) return existing;
        Uri created = DocumentsContract.createDocument(
                resolver,
                DocumentsContract.buildDocumentUriUsingTree(treeUri, parentId),
                guessMimeType(name),
                name
        );
        if (created == null) throw new IOException("无法创建文件：" + name);
        return DocumentsContract.getDocumentId(created);
    }

    private String guessMimeType(String name) {
        String lowerName = name.toLowerCase(Locale.US);
        if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "text/html";
        if (lowerName.endsWith(".css")) return "text/css";
        if (lowerName.endsWith(".js") || lowerName.endsWith(".mjs") || lowerName.endsWith(".cjs")) return "text/javascript";
        if (lowerName.endsWith(".json")) return "application/json";
        if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) return "text/markdown";
        if (lowerName.endsWith(".xml")) return "application/xml";
        if (lowerName.endsWith(".svg")) return "image/svg+xml";
        if (lowerName.endsWith(".csv")) return "text/csv";
        if (lowerName.endsWith(".ts") || lowerName.endsWith(".tsx")) return "text/typescript";
        if (lowerName.endsWith(".jsx")) return "text/jsx";
        if (lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")) return "application/yaml";
        if (lowerName.endsWith(".txt") || lowerName.endsWith(".log") || lowerName.endsWith(".env")) return "text/plain";
        return "application/octet-stream";
    }

    private String findChild(String parentDocumentId, String name) {
        for (DocumentEntry child : queryChildren(parentDocumentId)) {
            if (name.equals(child.name)) return child.documentId;
        }
        return null;
    }

    private String getDisplayName(String documentId) {
        try {
            return getEntry(documentId).name;
        } catch (Exception ignored) {
            return null;
        }
    }

    private DocumentEntry getEntry(String documentId) throws IOException {
        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        };
        try (Cursor cursor = resolver.query(documentUri, projection, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IOException("无法读取路径信息");
            return new DocumentEntry(
                    getString(cursor, 0),
                    getString(cursor, 1),
                    getString(cursor, 2),
                    getLong(cursor, 3),
                    getLong(cursor, 4),
                    ""
            );
        }
    }

    private List<DocumentEntry> queryChildren(String parentDocumentId) {
        List<DocumentEntry> entries = new ArrayList<>();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId);
        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        };
        try (Cursor cursor = resolver.query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return entries;
            while (cursor.moveToNext()) {
                entries.add(new DocumentEntry(
                        getString(cursor, 0),
                        getString(cursor, 1),
                        getString(cursor, 2),
                        getLong(cursor, 3),
                        getLong(cursor, 4),
                        ""
                ));
            }
        } catch (Exception ignored) {
        }
        return entries;
    }

    private void listFilesInto(String documentId, String basePath, boolean recursive, JSONArray results, int limit) throws JSONException {
        if (results.length() >= limit) return;
        for (DocumentEntry child : queryChildren(documentId)) {
            if (results.length() >= limit) return;
            String childPath = basePath.isEmpty() ? child.name : basePath + "/" + child.name;
            JSONObject item = new JSONObject();
            item.put("path", childPath);
            item.put("kind", child.isDirectory() ? "directory" : "file");
            results.put(item);
            if (recursive && child.isDirectory()) {
                listFilesInto(child.documentId, childPath, true, results, limit);
            }
        }
    }

    private void collectFiles(String documentId, String basePath, List<DocumentEntry> files, int limit) {
        if (files.size() >= limit) return;
        for (DocumentEntry child : queryChildren(documentId)) {
            if (files.size() >= limit) return;
            String childPath = basePath.isEmpty() ? child.name : basePath + "/" + child.name;
            child.path = childPath;
            if (child.isDirectory()) {
                collectFiles(child.documentId, childPath, files, limit);
            } else {
                files.add(child);
            }
        }
    }

    private void deleteChildren(String documentId) throws IOException {
        for (DocumentEntry child : queryChildren(documentId)) {
            if (child.isDirectory()) deleteChildren(child.documentId);
            DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(treeUri, child.documentId));
        }
    }

    private String readText(String documentId) throws IOException {
        return new String(readBytes(documentId), StandardCharsets.UTF_8);
    }

    private byte[] readBytes(String documentId) throws IOException {
        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
        try (InputStream input = resolver.openInputStream(documentUri)) {
            if (input == null) throw new IOException("无法读取文件");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private String buildPcTransferUrl(String baseUrl, String pathname, String workspacePath, String path) throws IOException {
        String normalizedBaseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        if (normalizedBaseUrl.isEmpty()) throw new IOException("缺少电脑服务地址");
        return normalizedBaseUrl
                + pathname
                + "?workspacePath=" + encodeQuery(workspacePath)
                + "&path=" + encodeQuery(path);
    }

    private String encodeQuery(String value) throws IOException {
        return URLEncoder.encode(value == null ? "" : value, "UTF-8");
    }

    private long copyStream(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[1024 * 1024];
        long bytes = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
            bytes += count;
        }
        output.flush();
        return bytes;
    }

    private String readConnectionError(HttpURLConnection connection, String fallback) {
        try (InputStream input = connection.getErrorStream()) {
            if (input == null) return fallback;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            String message = new String(output.toByteArray(), StandardCharsets.UTF_8).trim();
            return message.isEmpty() ? fallback : message;
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private String readStreamText(InputStream input) throws IOException {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private boolean isLikelyText(String name) {
        return name.matches("(?i).+\\.(cjs|css|csv|env|html|js|json|jsx|md|mjs|scss|ts|tsx|txt|xml|yaml|yml|java|kt)$");
    }

    private String getString(Cursor cursor, int index) {
        return cursor.isNull(index) ? "" : cursor.getString(index);
    }

    private long getLong(Cursor cursor, int index) {
        return cursor.isNull(index) ? 0L : cursor.getLong(index);
    }

    private String errorJson(Exception error) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("error", error.getMessage() == null ? "Android 文件工具失败" : error.getMessage());
        } catch (JSONException ignored) {
        }
        return payload.toString();
    }

    private static final class DocumentEntry {
        final String documentId;
        final String name;
        final String mimeType;
        final long size;
        final long modifiedAt;
        String path;

        DocumentEntry(String documentId, String name, String mimeType, long size, long modifiedAt, String path) {
            this.documentId = documentId;
            this.name = name;
            this.mimeType = mimeType;
            this.size = size;
            this.modifiedAt = modifiedAt;
            this.path = path;
        }

        boolean isDirectory() {
            return MIME_DIR.equals(mimeType);
        }
    }

    private static final class RootCommandResult {
        final int exitCode;
        final String stdout;
        final String stderr;

        RootCommandResult(int exitCode, String stdout, String stderr) {
            this.exitCode = exitCode;
            this.stdout = stdout == null ? "" : stdout;
            this.stderr = stderr == null ? "" : stderr;
        }
    }
}
