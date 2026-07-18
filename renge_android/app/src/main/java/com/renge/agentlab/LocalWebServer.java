package com.renge.agentlab;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.AtomicFile;
import android.webkit.WebStorage;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocalWebServer {
    private static final int PREFERRED_PORT = 5191;
    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final File appDataFile;
    private final File appDataBackupFile;

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private volatile boolean running;

    public LocalWebServer(Context context) {
        this.context = context.getApplicationContext();
        this.appDataFile = new File(this.context.getFilesDir(), "app-data.json");
        this.appDataBackupFile = new File(this.context.getFilesDir(), "app-data.previous.json");
    }

    public String start() throws IOException {
        try {
            serverSocket = new ServerSocket(PREFERRED_PORT, 50, InetAddress.getByName("127.0.0.1"));
        } catch (IOException ignored) {
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        }
        running = true;
        acceptThread = new Thread(this::acceptLoop, "renge-local-server");
        acceptThread.start();
        return "http://127.0.0.1:" + serverSocket.getLocalPort() + "/";
    }

    public void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
            }
        }
        executor.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                executor.execute(() -> handleSocket(socket));
            } catch (IOException ignored) {
                if (running) {
                    stop();
                }
            }
        }
    }

    private void handleSocket(Socket socket) {
        try (Socket closeableSocket = socket) {
            closeableSocket.setSoTimeout(30000);
            Request request = readRequest(new BufferedInputStream(closeableSocket.getInputStream()));
            if (request == null) return;

            OutputStream output = closeableSocket.getOutputStream();
            String requestHost = request.headers.getOrDefault("host", "")
                    .toLowerCase(Locale.US)
                    .replaceFirst(":\\d+$", "");
            if ("preview.localhost".equals(requestHost) && request.path.startsWith("/api/")) {
                sendJson(output, 404, jsonError("Not found"));
                output.flush();
                return;
            }
            if (request.path.startsWith("/api/")) {
                handleApi(request, output);
            } else {
                serveStatic(request.path, output);
            }
            output.flush();
        } catch (SocketTimeoutException ignored) {
        } catch (Exception error) {
            try {
                sendJson(socket.getOutputStream(), 500, jsonError(error.getMessage()));
            } catch (IOException ignored) {
            }
        }
    }

    private Request readRequest(BufferedInputStream input) throws IOException {
        ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
        int matched = 0;
        int value;
        while ((value = input.read()) != -1) {
            headerBytes.write(value);
            if ((matched == 0 && value == '\r')
                    || (matched == 1 && value == '\n')
                    || (matched == 2 && value == '\r')
                    || (matched == 3 && value == '\n')) {
                matched++;
                if (matched == 4) break;
            } else {
                matched = 0;
            }
            if (headerBytes.size() > 65536) {
                throw new IOException("Request headers are too large");
            }
        }

        if (headerBytes.size() == 0) return null;

        String headerText = headerBytes.toString(StandardCharsets.ISO_8859_1.name());
        String[] lines = headerText.split("\r\n");
        if (lines.length == 0) return null;

        String[] requestLine = lines[0].split(" ", 3);
        if (requestLine.length < 2) return null;

        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int separator = lines[i].indexOf(':');
            if (separator <= 0) continue;
            String name = lines[i].substring(0, separator).trim().toLowerCase(Locale.US);
            String body = lines[i].substring(separator + 1).trim();
            headers.put(name, body);
        }

        int contentLength = 0;
        if (headers.containsKey("content-length")) {
            contentLength = Integer.parseInt(headers.get("content-length"));
        }

        byte[] body = new byte[contentLength];
        int offset = 0;
        while (offset < contentLength) {
            int count = input.read(body, offset, contentLength - offset);
            if (count < 0) break;
            offset += count;
        }

        return new Request(
                requestLine[0].toUpperCase(Locale.US),
                normalizePath(requestLine[1]),
                headers,
                body
        );
    }

    private String normalizePath(String target) {
        try {
            URI uri = URI.create(target);
            String rawPath = uri.getRawPath();
            if (rawPath == null || rawPath.isEmpty()) return "/";
            return URLDecoder.decode(rawPath, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return "/";
        }
    }

    private void handleApi(Request request, OutputStream output) throws IOException, JSONException {
        if ("/api/app-data".equals(request.path)) {
            handleAppData(request, output);
            return;
        }

        if (!"POST".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }

        JSONObject body = parseJson(request.body);
        ProviderTarget target = getProviderTarget(body);

        if ("/api/providers/models".equals(request.path)) {
            proxyJson(output, target.apiBaseUrl + "/models", target.apiKey, "GET", null);
            return;
        }

        if ("/api/chat/completions".equals(request.path)) {
            JSONObject upstreamRequest = body.optJSONObject("request");
            if (upstreamRequest == null) {
                sendJson(output, 400, jsonError("缺少 request"));
                return;
            }

            if (upstreamRequest.optBoolean("stream", false)) {
                proxyStream(output, target.apiBaseUrl + "/chat/completions", target.apiKey, upstreamRequest);
            } else {
                proxyJson(output, target.apiBaseUrl + "/chat/completions", target.apiKey, "POST", upstreamRequest);
            }
            return;
        }

        sendJson(output, 404, jsonError("Not found"));
    }

    private void handleAppData(Request request, OutputStream output) throws IOException, JSONException {
        if ("GET".equals(request.method)) {
            JSONObject payload = new JSONObject();
            payload.put("dataDir", context.getFilesDir().getAbsolutePath());
            payload.put("dataFile", appDataFile.getAbsolutePath());
            payload.put("data", readAppData());
            sendJson(output, 200, payload);
            return;
        }

        if ("PUT".equals(request.method) || "POST".equals(request.method)) {
            JSONObject body = parseJson(request.body);
            Object data = body.has("data") ? body.get("data") : body;
            writeAppData(data);

            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("dataDir", context.getFilesDir().getAbsolutePath());
            payload.put("dataFile", appDataFile.getAbsolutePath());
            sendJson(output, 200, payload);
            return;
        }

        if ("DELETE".equals(request.method)) {
            clearAppData();
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("dataDir", context.getFilesDir().getAbsolutePath());
            payload.put("dataFile", appDataFile.getAbsolutePath());
            sendJson(output, 200, payload);
            return;
        }

        sendJson(output, 405, jsonError("Method not allowed"));
    }

    private JSONObject readJsonObject(File file) {
        try (InputStream input = new AtomicFile(file).openRead()) {
            byte[] bytes = readAll(input);
            String text = new String(bytes, StandardCharsets.UTF_8);
            return text.trim().isEmpty() ? null : new JSONObject(text);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void writeJsonAtomically(File file, String content) throws IOException {
        File parent = file.getParentFile();
        if (parent != null) parent.mkdirs();
        AtomicFile atomicFile = new AtomicFile(file);
        FileOutputStream output = null;
        try {
            output = atomicFile.startWrite();
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
            atomicFile.finishWrite(output);
        } catch (IOException error) {
            if (output != null) atomicFile.failWrite(output);
            throw error;
        }
    }

    private synchronized JSONObject readAppData() {
        JSONObject primary = readJsonObject(appDataFile);
        if (primary != null) return primary;

        JSONObject backup = readJsonObject(appDataBackupFile);
        if (backup != null) {
            try {
                writeJsonAtomically(appDataFile, backup.toString(2));
            } catch (Exception ignored) {
            }
            return backup;
        }
        return new JSONObject();
    }

    private synchronized void writeAppData(Object data) throws IOException {
        try {
            JSONObject normalized = data instanceof JSONObject
                    ? (JSONObject) data
                    : new JSONObject(String.valueOf(data));
            JSONObject current = readJsonObject(appDataFile);
            if (current != null) {
                writeJsonAtomically(appDataBackupFile, current.toString(2));
            }
            writeJsonAtomically(appDataFile, normalized.toString(2));
        } catch (JSONException error) {
            throw new IOException(error);
        }
    }

    private void deleteRecursively(File file) throws IOException {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
        }
        if (!file.delete() && file.exists()) {
            throw new IOException("无法删除应用数据：" + file.getAbsolutePath());
        }
    }

    private synchronized void clearAppData() throws IOException {
        new AtomicFile(appDataFile).delete();
        new AtomicFile(appDataBackupFile).delete();
        WebStorage.getInstance().deleteAllData();
        boolean preferencesCleared = context.getSharedPreferences("renge_android_workspace", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit();
        if (!preferencesCleared) throw new IOException("无法清除 Android 工作区设置。");
        for (String name : new String[]{"extensions", "generated-images", "session-images", "skills"}) {
            deleteRecursively(new File(context.getFilesDir(), name));
        }
    }

    private ProviderTarget getProviderTarget(JSONObject body) throws JSONException {
        String apiBaseUrl = body.optString("apiBaseUrl", "").trim().replaceAll("/+$", "");
        String apiKey = body.optString("apiKey", "");
        if (apiBaseUrl.isEmpty()) {
            throw new JSONException("缺少 apiBaseUrl");
        }
        return new ProviderTarget(apiBaseUrl, apiKey);
    }

    private void proxyJson(
            OutputStream output,
            String url,
            String apiKey,
            String method,
            JSONObject body
    ) throws IOException {
        HttpURLConnection connection = openConnection(url, apiKey, body == null ? "application/json" : "application/json");
        connection.setRequestMethod(method);
        if (body != null) {
            connection.setDoOutput(true);
            byte[] bodyBytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bodyBytes.length);
            try (OutputStream upstreamOutput = connection.getOutputStream()) {
                upstreamOutput.write(bodyBytes);
            }
        }

        int status = connection.getResponseCode();
        byte[] responseBody = readConnectionBody(connection, status);
        String contentType = connection.getContentType();
        if (contentType == null || contentType.trim().isEmpty()) {
            contentType = "application/json;charset=utf-8";
        }
        sendBytes(output, status, contentType, responseBody);
        connection.disconnect();
    }

    private void proxyStream(
            OutputStream output,
            String url,
            String apiKey,
            JSONObject body
    ) throws IOException {
        HttpURLConnection connection = openConnection(url, apiKey, "text/event-stream");
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        byte[] bodyBytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bodyBytes.length);
        try (OutputStream upstreamOutput = connection.getOutputStream()) {
            upstreamOutput.write(bodyBytes);
        }

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            sendBytes(output, status, "application/json;charset=utf-8", readConnectionBody(connection, status));
            connection.disconnect();
            return;
        }

        String contentType = connection.getContentType();
        if (contentType == null || contentType.trim().isEmpty()) {
            contentType = "text/event-stream;charset=utf-8";
        }

        writeHead(output, status, contentType, -1);
        try (InputStream upstreamInput = connection.getInputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = upstreamInput.read(buffer)) != -1) {
                output.write(buffer, 0, count);
                output.flush();
            }
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String url, String apiKey, String accept) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(120000);
        connection.setRequestProperty("Accept", accept);
        connection.setRequestProperty("Content-Type", "application/json");
        if (apiKey != null && !apiKey.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
        }
        return connection;
    }

    private byte[] readConnectionBody(HttpURLConnection connection, int status) throws IOException {
        InputStream stream = status >= 200 && status < 400
                ? connection.getInputStream()
                : connection.getErrorStream();
        if (stream == null) return new byte[0];
        try (InputStream closeable = stream) {
            return readAll(closeable);
        }
    }

    private void serveStatic(String path, OutputStream output) throws IOException {
        String assetPath = path.equals("/") ? "index.html" : stripLeadingSlash(path);
        if (assetPath.contains("..")) {
            sendBytes(output, 403, "text/plain;charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8));
            return;
        }

        try {
            sendAsset(output, assetPath);
        } catch (IOException missingAsset) {
            sendAsset(output, "index.html");
        }
    }

    private void sendAsset(OutputStream output, String assetPath) throws IOException {
        AssetManager assets = context.getAssets();
        try (InputStream input = assets.open("www/" + assetPath)) {
            sendBytes(output, 200, mimeType(assetPath), readAll(input));
        }
    }

    private String stripLeadingSlash(String value) {
        return value.startsWith("/") ? value.substring(1) : value;
    }

    private String mimeType(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html")) return "text/html;charset=utf-8";
        if (lower.endsWith(".js")) return "text/javascript;charset=utf-8";
        if (lower.endsWith(".css")) return "text/css;charset=utf-8";
        if (lower.endsWith(".json")) return "application/json;charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private JSONObject parseJson(byte[] bytes) throws JSONException {
        if (bytes == null || bytes.length == 0) return new JSONObject();
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }

    private JSONObject jsonError(String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("error", message == null ? "Internal server error" : message);
        } catch (JSONException ignored) {
        }
        return payload;
    }

    private void sendJson(OutputStream output, int status, JSONObject payload) throws IOException {
        sendBytes(
                output,
                status,
                "application/json;charset=utf-8",
                payload.toString().getBytes(StandardCharsets.UTF_8)
        );
    }

    private void sendBytes(OutputStream output, int status, String contentType, byte[] body) throws IOException {
        writeHead(output, status, contentType, body.length);
        output.write(body);
    }

    private void writeHead(OutputStream output, int status, String contentType, int contentLength) throws IOException {
        StringBuilder headers = new StringBuilder();
        headers.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
        headers.append("Content-Type: ").append(contentType).append("\r\n");
        headers.append("Cache-Control: no-store\r\n");
        headers.append("Connection: close\r\n");
        if (contentLength >= 0) {
            headers.append("Content-Length: ").append(contentLength).append("\r\n");
        }
        headers.append("\r\n");
        output.write(headers.toString().getBytes(StandardCharsets.UTF_8));
    }

    private String reason(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 400:
                return "Bad Request";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 405:
                return "Method Not Allowed";
            default:
                return status >= 500 ? "Internal Server Error" : "Status";
        }
    }

    private static byte[] readAll(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static final class Request {
        final String method;
        final String path;
        final Map<String, String> headers;
        final byte[] body;

        Request(String method, String path, Map<String, String> headers, byte[] body) {
            this.method = method;
            this.path = path;
            this.headers = headers;
            this.body = body;
        }
    }

    private static final class ProviderTarget {
        final String apiBaseUrl;
        final String apiKey;

        ProviderTarget(String apiBaseUrl, String apiKey) {
            this.apiBaseUrl = apiBaseUrl;
            this.apiKey = apiKey;
        }
    }
}
