package com.renge.agentlab;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.AtomicFile;
import android.util.JsonReader;
import android.util.JsonToken;
import android.webkit.WebStorage;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PushbackInputStream;
import java.io.Writer;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocalWebServer {
    private static final int PREFERRED_PORT = 5191;
    private static final long MAX_COMPLETE_BACKUP_BYTES = 512L * 1024L * 1024L;
    private static final Set<String> REQUIRED_APP_DATA_ARRAY_FIELDS = new HashSet<>(Arrays.asList(
            "personas",
            "providers",
            "chatSessions",
            "systemPrompts",
            "chatPresets",
            "worldBooks",
            "regexScripts",
            "tavernScripts",
            "characterCards",
            "mcpServers",
            "skills",
            "extensions"
    ));
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
            BufferedInputStream input = new BufferedInputStream(closeableSocket.getInputStream());
            Request request = readRequestHeaders(input);
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
            if ("/api/app-data/import-complete".equals(request.path)) {
                closeableSocket.setSoTimeout(120000);
                handleCompleteBackupImport(request, input, output);
                output.flush();
                return;
            }

            request = request.withBody(readRequestBody(input, request.contentLength));
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

    private Request readRequestHeaders(BufferedInputStream input) throws IOException {
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

        long contentLength = 0;
        if (headers.containsKey("content-length")) {
            try {
                contentLength = Long.parseLong(headers.get("content-length"));
            } catch (NumberFormatException error) {
                throw new IOException("Invalid Content-Length", error);
            }
            if (contentLength < 0) throw new IOException("Invalid Content-Length");
        }

        return new Request(
                requestLine[0].toUpperCase(Locale.US),
                normalizePath(requestLine[1]),
                headers,
                contentLength,
                null
        );
    }

    private byte[] readRequestBody(InputStream input, long contentLength) throws IOException {
        if (contentLength > Integer.MAX_VALUE) {
            throw new IOException("Request body is too large");
        }
        byte[] body = new byte[(int) contentLength];
        int offset = 0;
        while (offset < body.length) {
            int count = input.read(body, offset, body.length - offset);
            if (count < 0) throw new IOException("Unexpected end of request body");
            offset += count;
        }
        return body;
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

    private void handleCompleteBackupImport(
            Request request,
            InputStream input,
            OutputStream output
    ) throws IOException {
        if (!("PUT".equals(request.method) || "POST".equals(request.method))) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }
        if (request.contentLength <= 0) {
            sendJson(output, 400, jsonError("备份文件为空或无法确定文件大小。"));
            return;
        }
        if (request.contentLength > MAX_COMPLETE_BACKUP_BYTES) {
            sendJson(output, 400, jsonError("备份文件超过 512MB，无法导入。"));
            return;
        }

        File uploadedBackup = File.createTempFile("renge-complete-backup-", ".json", context.getCacheDir());
        try {
            copyFixedLength(input, uploadedBackup, request.contentLength);
            CompleteBackupMetadata metadata = installCompleteBackup(uploadedBackup);
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("exportedAt", metadata.exportedAt);
            payload.put("bytes", request.contentLength);
            sendJson(output, 200, payload);
        } catch (Exception error) {
            sendJson(
                    output,
                    400,
                    jsonError(error.getMessage() == null ? "完整备份格式无效。" : error.getMessage())
            );
        } finally {
            if (!uploadedBackup.delete() && uploadedBackup.exists()) {
                uploadedBackup.deleteOnExit();
            }
        }
    }

    private void copyFixedLength(InputStream input, File target, long contentLength) throws IOException {
        try (OutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            long remaining = contentLength;
            while (remaining > 0) {
                int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (count < 0) throw new IOException("备份文件上传不完整。请重新选择文件。");
                output.write(buffer, 0, count);
                remaining -= count;
            }
            output.flush();
        }
    }

    private CompleteBackupMetadata installCompleteBackup(File completeBackup) throws IOException {
        File stagedAppData = File.createTempFile("renge-app-data-import-", ".json", context.getCacheDir());
        try {
            CompleteBackupMetadata metadata = extractCompleteBackupAppData(completeBackup, stagedAppData);
            validateImportedAppData(stagedAppData);
            synchronized (this) {
                if (appDataFile.isFile() && appDataFile.length() > 0) {
                    copyFileAtomically(appDataFile, appDataBackupFile);
                }
                copyFileAtomically(stagedAppData, appDataFile);
            }
            return metadata;
        } finally {
            if (!stagedAppData.delete() && stagedAppData.exists()) {
                stagedAppData.deleteOnExit();
            }
        }
    }

    private CompleteBackupMetadata extractCompleteBackupAppData(
            File completeBackup,
            File stagedAppData
    ) throws IOException {
        String format = null;
        String version = null;
        String exportedAt = null;
        boolean appDataFound = false;
        boolean localStorageFound = false;

        try (PushbackInputStream input = new PushbackInputStream(
                new BufferedInputStream(new java.io.FileInputStream(completeBackup)),
                1
        )) {
            int rootStart = readNonWhitespace(input);
            if (rootStart != '{') throw new IOException("备份文件不是有效的 JSON 对象。");

            while (true) {
                int next = readNonWhitespace(input);
                if (next == '}') break;
                if (next != '"') throw new IOException("备份文件顶层字段格式无效。");
                String key = readJsonString(input);
                if (readNonWhitespace(input) != ':') {
                    throw new IOException("备份文件字段缺少冒号：" + key);
                }
                int valueStart = readNonWhitespace(input);
                if (valueStart < 0) throw new IOException("备份文件意外结束。");

                if ("format".equals(key)) {
                    if (valueStart != '"') throw new IOException("备份格式标识无效。");
                    format = readJsonString(input);
                } else if ("version".equals(key)) {
                    version = readJsonPrimitive(input, valueStart);
                } else if ("exportedAt".equals(key)) {
                    if (valueStart != '"') throw new IOException("备份导出时间无效。");
                    exportedAt = readJsonString(input);
                } else if ("appData".equals(key)) {
                    if (appDataFound || valueStart != '{') {
                        throw new IOException("备份中的应用主数据无效。");
                    }
                    try (OutputStream appDataOutput = new FileOutputStream(stagedAppData)) {
                        copyJsonComposite(input, valueStart, appDataOutput);
                    }
                    appDataFound = true;
                } else if ("localStorage".equals(key)) {
                    if (valueStart != '{') throw new IOException("备份中的本地设置格式无效。");
                    copyJsonComposite(input, valueStart, null);
                    localStorageFound = true;
                } else {
                    skipJsonValue(input, valueStart);
                }

                int separator = readNonWhitespace(input);
                if (separator == '}') break;
                if (separator != ',') throw new IOException("备份文件顶层 JSON 格式无效。");
            }

            if (readNonWhitespace(input) >= 0) {
                throw new IOException("备份文件包含多余内容。");
            }
        }

        if (!"renge-agent-complete-backup".equals(format)) {
            throw new IOException("这不是 Renge Agent 完整备份文件。");
        }
        if (!"1".equals(version)) {
            throw new IOException("暂不支持此备份版本：" + (version == null ? "未知" : version) + "。");
        }
        if (exportedAt == null || exportedAt.trim().isEmpty()) {
            throw new IOException("备份缺少导出时间。");
        }
        if (!appDataFound || stagedAppData.length() == 0) {
            throw new IOException("备份缺少应用主数据。");
        }
        if (!localStorageFound) {
            throw new IOException("备份缺少本地设置数据。");
        }
        return new CompleteBackupMetadata(exportedAt);
    }

    private void validateImportedAppData(File stagedAppData) throws IOException {
        Set<String> missingFields = new HashSet<>(REQUIRED_APP_DATA_ARRAY_FIELDS);
        try (JsonReader reader = new JsonReader(new InputStreamReader(
                new java.io.FileInputStream(stagedAppData),
                StandardCharsets.UTF_8
        ))) {
            reader.beginObject();
            while (reader.hasNext()) {
                String name = reader.nextName();
                if (missingFields.contains(name)) {
                    if (reader.peek() != JsonToken.BEGIN_ARRAY) {
                        throw new IOException("备份缺少完整数据字段：" + name + "。");
                    }
                    missingFields.remove(name);
                }
                reader.skipValue();
            }
            reader.endObject();
            if (reader.peek() != JsonToken.END_DOCUMENT) {
                throw new IOException("应用主数据包含多余内容。");
            }
        } catch (IllegalStateException error) {
            throw new IOException("应用主数据 JSON 格式无效。", error);
        }
        if (!missingFields.isEmpty()) {
            throw new IOException("备份缺少完整数据字段：" + missingFields.iterator().next() + "。");
        }
    }

    private void copyFileAtomically(File source, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent != null) parent.mkdirs();
        AtomicFile atomicFile = new AtomicFile(target);
        FileOutputStream output = null;
        try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(source))) {
            output = atomicFile.startWrite();
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            output.getFD().sync();
            atomicFile.finishWrite(output);
        } catch (IOException error) {
            if (output != null) atomicFile.failWrite(output);
            throw error;
        }
    }

    private int readNonWhitespace(InputStream input) throws IOException {
        int value;
        do {
            value = input.read();
        } while (value == ' ' || value == '\t' || value == '\r' || value == '\n');
        return value;
    }

    private String readJsonString(InputStream input) throws IOException {
        StringBuilder value = new StringBuilder();
        boolean escaped = false;
        while (true) {
            int next = input.read();
            if (next < 0) throw new IOException("JSON 字符串意外结束。");
            if (!escaped && next == '"') return value.toString();
            if (!escaped && next == '\\') {
                escaped = true;
                continue;
            }
            if (escaped) {
                switch (next) {
                    case '"': value.append('"'); break;
                    case '\\': value.append('\\'); break;
                    case '/': value.append('/'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'u':
                        int codePoint = 0;
                        for (int index = 0; index < 4; index++) {
                            int digit = Character.digit(input.read(), 16);
                            if (digit < 0) throw new IOException("JSON Unicode 转义无效。");
                            codePoint = (codePoint << 4) | digit;
                        }
                        value.append((char) codePoint);
                        break;
                    default:
                        throw new IOException("JSON 转义字符无效。");
                }
                escaped = false;
            } else {
                if (next < 0x20) throw new IOException("JSON 字符串包含无效控制字符。");
                value.append((char) next);
            }
            if (value.length() > 16384) throw new IOException("备份字段名称或元数据过长。");
        }
    }

    private String readJsonPrimitive(PushbackInputStream input, int first) throws IOException {
        StringBuilder value = new StringBuilder();
        int next = first;
        while (next >= 0) {
            if (next == ',' || next == '}' || next == ']') {
                input.unread(next);
                break;
            }
            if (next == ' ' || next == '\t' || next == '\r' || next == '\n') break;
            value.append((char) next);
            if (value.length() > 128) throw new IOException("JSON 基本值过长。");
            next = input.read();
        }
        if (value.length() == 0) throw new IOException("JSON 基本值为空。");
        return value.toString();
    }

    private void skipJsonValue(PushbackInputStream input, int first) throws IOException {
        if (first == '{' || first == '[') {
            copyJsonComposite(input, first, null);
        } else if (first == '"') {
            readJsonString(input);
        } else {
            readJsonPrimitive(input, first);
        }
    }

    private void copyJsonComposite(
            InputStream input,
            int first,
            OutputStream output
    ) throws IOException {
        ArrayDeque<Integer> expectedClosings = new ArrayDeque<>();
        expectedClosings.push(first == '{' ? (int) '}' : (int) ']');
        if (output != null) output.write(first);
        boolean inString = false;
        boolean escaped = false;

        while (!expectedClosings.isEmpty()) {
            int next = input.read();
            if (next < 0) throw new IOException("JSON 对象或数组意外结束。");
            if (output != null) output.write(next);

            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (next == '\\') {
                    escaped = true;
                } else if (next == '"') {
                    inString = false;
                } else if (next < 0x20) {
                    throw new IOException("JSON 字符串包含无效控制字符。");
                }
                continue;
            }

            if (next == '"') {
                inString = true;
            } else if (next == '{') {
                expectedClosings.push((int) '}');
            } else if (next == '[') {
                expectedClosings.push((int) ']');
            } else if (next == '}' || next == ']') {
                if (expectedClosings.isEmpty() || expectedClosings.pop() != next) {
                    throw new IOException("JSON 对象与数组括号不匹配。");
                }
            }
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
            sendAppData(output);
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

    private void writeJsonAtomically(File file, String content) throws IOException {
        File parent = file.getParentFile();
        if (parent != null) parent.mkdirs();
        AtomicFile atomicFile = new AtomicFile(file);
        FileOutputStream output = null;
        try {
            output = atomicFile.startWrite();
            Writer writer = new OutputStreamWriter(output, StandardCharsets.UTF_8);
            writer.write(content);
            writer.flush();
            output.getFD().sync();
            atomicFile.finishWrite(output);
        } catch (IOException error) {
            if (output != null) atomicFile.failWrite(output);
            throw error;
        }
    }

    private synchronized void sendAppData(OutputStream output) throws IOException {
        File source = null;
        if (appDataFile.isFile() && appDataFile.length() > 0) {
            source = appDataFile;
        } else if (appDataBackupFile.isFile() && appDataBackupFile.length() > 0) {
            copyFileAtomically(appDataBackupFile, appDataFile);
            source = appDataFile;
        }

        String prefix = "{\"dataDir\":"
                + JSONObject.quote(context.getFilesDir().getAbsolutePath())
                + ",\"dataFile\":"
                + JSONObject.quote(appDataFile.getAbsolutePath())
                + ",\"data\":";
        byte[] prefixBytes = prefix.getBytes(StandardCharsets.UTF_8);
        byte[] emptyDataBytes = "{}".getBytes(StandardCharsets.UTF_8);
        byte[] suffixBytes = "}".getBytes(StandardCharsets.UTF_8);
        long dataLength = source == null ? emptyDataBytes.length : source.length();
        writeHead(
                output,
                200,
                "application/json;charset=utf-8",
                prefixBytes.length + dataLength + suffixBytes.length
        );
        output.write(prefixBytes);
        if (source == null) {
            output.write(emptyDataBytes);
        } else {
            try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(source))) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
            }
        }
        output.write(suffixBytes);
    }

    private synchronized void writeAppData(Object data) throws IOException {
        try {
            JSONObject normalized = data instanceof JSONObject
                    ? (JSONObject) data
                    : new JSONObject(String.valueOf(data));
            if (appDataFile.isFile() && appDataFile.length() > 0) {
                copyFileAtomically(appDataFile, appDataBackupFile);
            }
            writeJsonAtomically(appDataFile, normalized.toString());
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

    private void writeHead(OutputStream output, int status, String contentType, long contentLength) throws IOException {
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
        final long contentLength;
        final byte[] body;

        Request(
                String method,
                String path,
                Map<String, String> headers,
                long contentLength,
                byte[] body
        ) {
            this.method = method;
            this.path = path;
            this.headers = headers;
            this.contentLength = contentLength;
            this.body = body;
        }

        Request withBody(byte[] nextBody) {
            return new Request(method, path, headers, contentLength, nextBody);
        }
    }

    private static final class CompleteBackupMetadata {
        final String exportedAt;

        CompleteBackupMetadata(String exportedAt) {
            this.exportedAt = exportedAt;
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
