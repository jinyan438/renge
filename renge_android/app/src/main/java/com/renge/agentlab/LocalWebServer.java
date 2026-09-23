package com.renge.agentlab;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.AtomicFile;
import android.util.Base64;
import android.util.JsonReader;
import android.util.JsonToken;
import android.util.JsonWriter;
import android.webkit.WebStorage;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.constructor.SafeConstructor;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PushbackInputStream;
import java.io.Writer;
import java.math.BigDecimal;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LocalWebServer {
    public interface RequestLifecycleListener {
        void onGenerationRequestStarted();
        void onGenerationRequestFinished();
    }

    private static final RequestLifecycleListener NO_OP_REQUEST_LIFECYCLE_LISTENER = new RequestLifecycleListener() {
        @Override
        public void onGenerationRequestStarted() {
        }

        @Override
        public void onGenerationRequestFinished() {
        }
    };
    private static final int PREFERRED_PORT = 5191;
    private static final String PI_KERNEL_ID = "@earendil-works/pi-coding-agent@0.87.1";
    private static final long MAX_COMPLETE_BACKUP_BYTES = 512L * 1024L * 1024L;
    private static final String COMPLETE_BACKUP_MANIFEST_FILE = "backup.json";
    private static final String COMPLETE_BACKUP_ASSET_PREFIX = "renge-backup-asset:";
    private static final String[] COMPLETE_BACKUP_MANAGED_ROOTS = new String[]{
            ".pi", "extensions", "generated-images", "session-images", "skills", "tavern-files"
    };
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
    private final File appDataAssetsDirectory;
    private final File appDataAssetsBackupDirectory;
    private final File appDataManagedBackupDirectory;
    private final Map<String, PiSessionState> piSessions = new ConcurrentHashMap<>();
    private final Map<String, HttpURLConnection> activePiRuns = new ConcurrentHashMap<>();
    private final RequestLifecycleListener requestLifecycleListener;

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private volatile boolean running;

    public LocalWebServer(Context context) {
        this(context, NO_OP_REQUEST_LIFECYCLE_LISTENER);
    }

    public LocalWebServer(Context context, RequestLifecycleListener requestLifecycleListener) {
        this.context = context.getApplicationContext();
        this.requestLifecycleListener = requestLifecycleListener == null
                ? NO_OP_REQUEST_LIFECYCLE_LISTENER
                : requestLifecycleListener;
        this.appDataFile = new File(this.context.getFilesDir(), "app-data.json");
        this.appDataBackupFile = new File(this.context.getFilesDir(), "app-data.previous.json");
        this.appDataAssetsDirectory = new File(this.context.getFilesDir(), "app-data-assets");
        this.appDataAssetsBackupDirectory = new File(this.context.getFilesDir(), "app-data-assets.previous");
        this.appDataManagedBackupDirectory = new File(this.context.getFilesDir(), "app-data-managed.previous");
    }

    public String start() throws IOException {
        try {
            serverSocket = createServerSocket(PREFERRED_PORT);
        } catch (IOException ignored) {
            serverSocket = createServerSocket(0);
        }
        running = true;
        acceptThread = new Thread(this::acceptLoop, "renge-local-server");
        acceptThread.start();
        return "http://127.0.0.1:" + serverSocket.getLocalPort() + "/";
    }

    private ServerSocket createServerSocket(int port) throws IOException {
        ServerSocket socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 50);
        return socket;
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
        boolean generationRequest = false;
        try (Socket closeableSocket = socket) {
            closeableSocket.setSoTimeout(30000);
            BufferedInputStream input = new BufferedInputStream(closeableSocket.getInputStream());
            Request request = readRequestHeaders(input);
            if (request == null) return;

            generationRequest = isGenerationRequest(request);
            if (generationRequest) requestLifecycleListener.onGenerationRequestStarted();

            OutputStream output = closeableSocket.getOutputStream();
            String requestHost = request.headers.getOrDefault("host", "")
                    .toLowerCase(Locale.US)
                    .replaceFirst(":\\d+$", "");
            if ("preview.localhost".equals(requestHost) && (request.path.startsWith("/api/") || request.path.startsWith("/user/files/") || isTavernStorageModule(request.path))) {
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
            if (isTavernStorageModule(request.path)) {
                sendAsset(output, "tavern-storage-compat.js");
            } else if (request.path.startsWith("/user/files/")) {
                serveTavernFile(request, output);
            } else if (request.path.startsWith("/api/")) {
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
        } finally {
            if (generationRequest) requestLifecycleListener.onGenerationRequestFinished();
        }
    }

    private boolean isGenerationRequest(Request request) {
        if (!"POST".equals(request.method)) return false;
        return "/api/chat/completions".equals(request.path)
                || "/api/pi/chat".equals(request.path)
                || "/api/backends/chat-completions/generate".equals(request.path);
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
                requestLine[1],
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

        File uploadedBackup = File.createTempFile("renge-complete-backup-", ".backup", context.getCacheDir());
        try {
            copyFixedLength(input, uploadedBackup, request.contentLength);
            CompleteBackupMetadata metadata = installCompleteBackup(uploadedBackup);
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("exportedAt", metadata.exportedAt);
            payload.put("localStorage", metadata.localStorage);
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
        if (isZipFile(completeBackup)) return installCompleteBackupZip(completeBackup);
        File stagedAppData = File.createTempFile("renge-app-data-import-", ".json", context.getCacheDir());
        File stagedLocalStorage = File.createTempFile("renge-local-storage-import-", ".json", context.getCacheDir());
        try {
            CompleteBackupMetadata metadata = extractCompleteBackupAppData(
                    completeBackup,
                    stagedAppData,
                    null,
                    stagedLocalStorage
            );
            if (metadata.version >= 3) throw new IOException("新版完整备份必须使用 ZIP 文件。");
            validateImportedAppData(stagedAppData, metadata.version);
            installStagedAppData(stagedAppData, null, null);
            return metadata;
        } finally {
            for (File stagedFile : new File[]{stagedAppData, stagedLocalStorage}) {
                if (!stagedFile.delete() && stagedFile.exists()) stagedFile.deleteOnExit();
            }
        }
    }

    private boolean isZipFile(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            return input.read() == 0x50 && input.read() == 0x4b && input.read() == 0x03 && input.read() == 0x04;
        }
    }

    private CompleteBackupMetadata installCompleteBackupZip(File completeBackup) throws IOException {
        File stagedManifest = File.createTempFile("renge-backup-manifest-", ".json", context.getCacheDir());
        File stagedRawAppData = File.createTempFile("renge-app-data-raw-", ".json", context.getCacheDir());
        File stagedAppData = File.createTempFile("renge-app-data-import-", ".json", context.getCacheDir());
        File stagedManagedFiles = File.createTempFile("renge-backup-files-index-", ".json", context.getCacheDir());
        File stagedLocalStorage = File.createTempFile("renge-local-storage-import-", ".json", context.getCacheDir());
        File stagedAssets = new File(
                context.getFilesDir(),
                ".app-data-assets-import-" + System.nanoTime()
        );
        File stagedFiles = new File(
                context.getFilesDir(),
                ".app-data-files-import-" + System.nanoTime()
        );
        if (!stagedAssets.mkdirs()) throw new IOException("无法创建图片资源暂存目录。");
        try {
            if (!stagedFiles.mkdirs()) throw new IOException("无法创建应用文件暂存目录。");
            extractCompleteBackupZip(completeBackup, stagedManifest, stagedAssets, stagedFiles);
            CompleteBackupMetadata metadata = extractCompleteBackupAppData(
                    stagedManifest,
                    stagedRawAppData,
                    stagedManagedFiles,
                    stagedLocalStorage
            );
            if (metadata.version != 2 && metadata.version != 3) {
                throw new IOException("ZIP 完整备份版本无效：" + metadata.version + "。");
            }
            validateImportedAppData(stagedRawAppData, metadata.version);
            if (metadata.version >= 3) {
                validateCompleteBackupManagedFiles(stagedManagedFiles, stagedFiles);
            }
            rewriteImportedAssetReferences(stagedRawAppData, stagedAppData, stagedAssets);
            if (metadata.version >= 3) {
                for (String root : COMPLETE_BACKUP_MANAGED_ROOTS) {
                    File stagedRoot = new File(stagedFiles, root);
                    if (!stagedRoot.mkdirs() && !stagedRoot.isDirectory()) {
                        throw new IOException("无法准备应用文件目录：" + root);
                    }
                }
            }
            installStagedAppData(stagedAppData, stagedAssets, metadata.version >= 3 ? stagedFiles : null);
            return metadata;
        } finally {
            for (File stagedFile : new File[]{stagedManifest, stagedRawAppData, stagedAppData, stagedManagedFiles, stagedLocalStorage}) {
                if (!stagedFile.delete() && stagedFile.exists()) stagedFile.deleteOnExit();
            }
            if (stagedAssets.exists()) {
                try {
                    deleteRecursively(stagedAssets);
                } catch (IOException ignored) {
                }
            }
            if (stagedFiles.exists()) {
                try {
                    deleteRecursively(stagedFiles);
                } catch (IOException ignored) {
                }
            }
        }
    }

    private void extractCompleteBackupZip(
            File completeBackup,
            File stagedManifest,
            File stagedAssets,
            File stagedFiles
    ) throws IOException {
        boolean manifestFound = false;
        long extractedBytes = 0;
        byte[] buffer = new byte[64 * 1024];
        String assetsCanonicalPath = stagedAssets.getCanonicalPath() + File.separator;
        String filesCanonicalPath = stagedFiles.getCanonicalPath() + File.separator;
        try (ZipInputStream zipInput = new ZipInputStream(
                new BufferedInputStream(new FileInputStream(completeBackup))
        )) {
            ZipEntry entry;
            while ((entry = zipInput.getNextEntry()) != null) {
                String entryName = entry.getName().replace('\\', '/');
                if (entry.isDirectory()) {
                    zipInput.closeEntry();
                    continue;
                }

                File target = null;
                if (COMPLETE_BACKUP_MANIFEST_FILE.equals(entryName)) {
                    if (manifestFound) throw new IOException("ZIP 备份包含重复的 backup.json。");
                    manifestFound = true;
                    target = stagedManifest;
                } else if (entryName.startsWith("assets/")) {
                    String relativePath = entryName.substring("assets/".length());
                    if (relativePath.isEmpty()) {
                        zipInput.closeEntry();
                        continue;
                    }
                    if (!isSupportedImageAsset(relativePath)) {
                        throw new IOException("ZIP 包含不支持的图片资源格式。");
                    }
                    target = new File(stagedAssets, relativePath);
                    String targetCanonicalPath = target.getCanonicalPath();
                    if (!targetCanonicalPath.startsWith(assetsCanonicalPath)) {
                        throw new IOException("ZIP 图片资源路径非法。");
                    }
                    File parent = target.getParentFile();
                    if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                        throw new IOException("无法创建图片资源目录。");
                    }
                } else if (entryName.startsWith("files/")) {
                    String relativePath = normalizeCompleteBackupManagedPath(
                            entryName.substring("files/".length())
                    );
                    if (relativePath == null) throw new IOException("ZIP 应用文件路径非法。");
                    target = new File(stagedFiles, relativePath);
                    String targetCanonicalPath = target.getCanonicalPath();
                    if (!targetCanonicalPath.startsWith(filesCanonicalPath)) {
                        throw new IOException("ZIP 应用文件路径越界。");
                    }
                    File parent = target.getParentFile();
                    if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                        throw new IOException("无法创建应用文件目录。");
                    }
                }

                OutputStream entryOutput = target == null
                        ? null
                        : new BufferedOutputStream(new FileOutputStream(target));
                try {
                    int count;
                    while ((count = zipInput.read(buffer)) != -1) {
                        extractedBytes += count;
                        if (extractedBytes > MAX_COMPLETE_BACKUP_BYTES) {
                            throw new IOException("ZIP 解压后的数据超过 512MB。");
                        }
                        if (entryOutput != null) entryOutput.write(buffer, 0, count);
                    }
                } finally {
                    if (entryOutput != null) entryOutput.close();
                }
                zipInput.closeEntry();
            }
        }
        if (!manifestFound || stagedManifest.length() == 0) {
            throw new IOException("ZIP 备份缺少 backup.json。");
        }
    }

    private void rewriteImportedAssetReferences(
            File rawAppData,
            File rewrittenAppData,
            File stagedAssets
    ) throws IOException {
        try (
                JsonReader reader = new JsonReader(new InputStreamReader(
                        new FileInputStream(rawAppData),
                        StandardCharsets.UTF_8
                ));
                FileOutputStream fileOutput = new FileOutputStream(rewrittenAppData);
                JsonWriter writer = new JsonWriter(new OutputStreamWriter(
                        fileOutput,
                        StandardCharsets.UTF_8
                ))
        ) {
            copyImportedJsonValue(reader, writer, stagedAssets);
            if (reader.peek() != JsonToken.END_DOCUMENT) {
                throw new IOException("应用主数据包含多余内容。");
            }
            writer.flush();
            fileOutput.getFD().sync();
        } catch (IllegalStateException error) {
            throw new IOException("应用主数据 JSON 格式无效。", error);
        }
    }

    private void copyImportedJsonValue(
            JsonReader reader,
            JsonWriter writer,
            File stagedAssets
    ) throws IOException {
        JsonToken token = reader.peek();
        switch (token) {
            case BEGIN_OBJECT:
                reader.beginObject();
                writer.beginObject();
                while (reader.hasNext()) {
                    String name = reader.nextName();
                    writer.name(name);
                    copyImportedJsonValue(reader, writer, stagedAssets);
                }
                reader.endObject();
                writer.endObject();
                return;
            case BEGIN_ARRAY:
                reader.beginArray();
                writer.beginArray();
                while (reader.hasNext()) copyImportedJsonValue(reader, writer, stagedAssets);
                reader.endArray();
                writer.endArray();
                return;
            case STRING:
                String value = reader.nextString();
                if (value.startsWith(COMPLETE_BACKUP_ASSET_PREFIX)) {
                    String archivePath = value.substring(COMPLETE_BACKUP_ASSET_PREFIX.length())
                            .replace('\\', '/');
                    if (!archivePath.startsWith("assets/")) {
                        throw new IOException("图片资源引用路径非法。");
                    }
                    String relativePath = archivePath.substring("assets/".length());
                    File assetFile = new File(stagedAssets, relativePath);
                    String assetsCanonicalPath = stagedAssets.getCanonicalPath() + File.separator;
                    if (!assetFile.getCanonicalPath().startsWith(assetsCanonicalPath)
                            || !assetFile.isFile()) {
                        throw new IOException("备份缺少图片资源：" + archivePath);
                    }
                    writer.value("/api/app-data/assets/" + relativePath.replace(File.separatorChar, '/'));
                } else {
                    writer.value(value);
                }
                return;
            case NUMBER:
                writer.value(new BigDecimal(reader.nextString()));
                return;
            case BOOLEAN:
                writer.value(reader.nextBoolean());
                return;
            case NULL:
                reader.nextNull();
                writer.nullValue();
                return;
            default:
                throw new IOException("应用主数据包含不支持的 JSON 值。");
        }
    }

    private void installStagedAppData(File stagedAppData, File stagedAssets, File stagedFiles) throws IOException {
        synchronized (this) {
            boolean appDataBackedUp = appDataFile.isFile() && appDataFile.length() > 0;
            if (appDataBackedUp) {
                copyFileAtomically(appDataFile, appDataBackupFile);
            }
            boolean assetsRotated = false;
            File managedRollbackDirectory = null;
            ArrayList<String> managedRootsMoved = new ArrayList<>();
            try {
                if (stagedAssets != null) {
                    if (appDataAssetsBackupDirectory.exists()) {
                        deleteRecursively(appDataAssetsBackupDirectory);
                    }
                    if (appDataAssetsDirectory.exists()) {
                        if (!appDataAssetsDirectory.renameTo(appDataAssetsBackupDirectory)) {
                            throw new IOException("无法备份当前图片资源。");
                        }
                        assetsRotated = true;
                    }
                    if (!stagedAssets.renameTo(appDataAssetsDirectory)) {
                        throw new IOException("无法安装备份图片资源。");
                    }
                }
                if (stagedFiles != null) {
                    managedRollbackDirectory = new File(
                            context.getFilesDir(),
                            ".app-data-managed-import-" + System.nanoTime()
                    );
                    if (!managedRollbackDirectory.mkdirs()) {
                        throw new IOException("无法准备应用文件回滚目录。");
                    }
                    for (String root : COMPLETE_BACKUP_MANAGED_ROOTS) {
                        File current = new File(context.getFilesDir(), root);
                        File previous = new File(managedRollbackDirectory, root);
                        File staged = new File(stagedFiles, root);
                        if (!staged.isDirectory()) throw new IOException("备份缺少应用目录：" + root);
                        if (current.exists()) {
                            File parent = previous.getParentFile();
                            if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                                throw new IOException("无法备份应用文件目录：" + root);
                            }
                            if (!current.renameTo(previous)) {
                                throw new IOException("无法备份当前应用文件目录：" + root);
                            }
                        }
                        managedRootsMoved.add(root);
                        if (!staged.renameTo(current)) {
                            throw new IOException("无法安装应用文件目录：" + root);
                        }
                    }
                }
                copyFileAtomically(stagedAppData, appDataFile);
                if (managedRollbackDirectory != null) {
                    if (appDataManagedBackupDirectory.exists()) {
                        deleteRecursively(appDataManagedBackupDirectory);
                    }
                    if (!managedRollbackDirectory.renameTo(appDataManagedBackupDirectory)) {
                        throw new IOException("无法保存上一版应用文件备份。");
                    }
                    managedRollbackDirectory = null;
                }
            } catch (IOException error) {
                ArrayList<String> rollbackFailures = new ArrayList<>();
                if (stagedAssets != null) {
                    try {
                        deleteRecursively(appDataAssetsDirectory);
                    } catch (IOException rollbackError) {
                        rollbackFailures.add(rollbackError.getMessage());
                    }
                    if (assetsRotated && !appDataAssetsBackupDirectory.renameTo(appDataAssetsDirectory)) {
                        rollbackFailures.add("无法恢复上一版图片资源");
                    }
                }
                for (int index = managedRootsMoved.size() - 1; index >= 0; index--) {
                    String root = managedRootsMoved.get(index);
                    File current = new File(context.getFilesDir(), root);
                    File previous = managedRollbackDirectory == null
                            ? new File(appDataManagedBackupDirectory, root)
                            : new File(managedRollbackDirectory, root);
                    try {
                        deleteRecursively(current);
                    } catch (IOException rollbackError) {
                        rollbackFailures.add(rollbackError.getMessage());
                    }
                    if (previous.exists() && !previous.renameTo(current)) {
                        rollbackFailures.add("无法恢复上一版应用文件：" + root);
                    }
                }
                if (appDataBackedUp) {
                    try {
                        copyFileAtomically(appDataBackupFile, appDataFile);
                    } catch (IOException rollbackError) {
                        rollbackFailures.add(rollbackError.getMessage());
                    }
                }
                if (managedRollbackDirectory != null && rollbackFailures.isEmpty()) {
                    try {
                        deleteRecursively(managedRollbackDirectory);
                    } catch (IOException rollbackError) {
                        rollbackFailures.add(rollbackError.getMessage());
                    }
                }
                if (!rollbackFailures.isEmpty()) {
                    String preservedFiles = managedRollbackDirectory != null && managedRollbackDirectory.exists()
                            ? " 应用文件备份保留在 " + managedRollbackDirectory.getAbsolutePath() + "。"
                            : " 原有应用文件仍保留在上一版备份目录。";
                    throw new IOException(
                            error.getMessage() + "；自动回滚未完成："
                                    + android.text.TextUtils.join("；", rollbackFailures)
                                    + "。" + preservedFiles,
                            error
                    );
                }
                throw error;
            }
        }
    }

    private CompleteBackupMetadata extractCompleteBackupAppData(
            File completeBackup,
            File stagedAppData,
            File stagedManagedFiles,
            File stagedLocalStorage
    ) throws IOException {
        String format = null;
        String version = null;
        String exportedAt = null;
        boolean appDataFound = false;
        boolean localStorageFound = false;
        boolean managedFilesFound = false;

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
                    if (localStorageFound || valueStart != '{') {
                        throw new IOException("备份中的本地设置格式无效。");
                    }
                    try (OutputStream localStorageOutput = new FileOutputStream(stagedLocalStorage)) {
                        copyJsonComposite(input, valueStart, localStorageOutput);
                    }
                    localStorageFound = true;
                } else if ("managedFiles".equals(key)) {
                    if (managedFilesFound || valueStart != '[') {
                        throw new IOException("备份中的应用文件索引无效。");
                    }
                    if (stagedManagedFiles != null) {
                        try (OutputStream filesIndexOutput = new FileOutputStream(stagedManagedFiles)) {
                            copyJsonComposite(input, valueStart, filesIndexOutput);
                        }
                    } else {
                        copyJsonComposite(input, valueStart, null);
                    }
                    managedFilesFound = true;
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
        if (!("1".equals(version) || "2".equals(version) || "3".equals(version))) {
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
        int parsedVersion = Integer.parseInt(version);
        if (parsedVersion >= 3 && !managedFilesFound) {
            throw new IOException("备份缺少应用文件索引。");
        }
        JSONObject localStorage;
        try (InputStream input = new FileInputStream(stagedLocalStorage)) {
            localStorage = new JSONObject(new String(readAll(input), StandardCharsets.UTF_8));
            Iterator<String> keys = localStorage.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!key.startsWith("renge") || !(localStorage.opt(key) instanceof String)) {
                    throw new IOException("备份中的本地设置格式无效。");
                }
            }
        } catch (JSONException error) {
            throw new IOException("备份中的本地设置格式无效。", error);
        }
        return new CompleteBackupMetadata(exportedAt, parsedVersion, localStorage);
    }

    private void validateImportedAppData(File stagedAppData, int version) throws IOException {
        Set<String> missingFields = new HashSet<>(REQUIRED_APP_DATA_ARRAY_FIELDS);
        if (version >= 3) missingFields.add("statusBarPresets");
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

    private void validateCompleteBackupManagedFiles(File indexFile, File stagedFiles) throws IOException {
        Set<String> indexed = new HashSet<>();
        String stagedRoot = stagedFiles.getCanonicalPath() + File.separator;
        try {
            String indexContent;
            try (InputStream input = new FileInputStream(indexFile)) {
                indexContent = new String(readAll(input), StandardCharsets.UTF_8);
            }
            JSONArray entries = new JSONArray(indexContent);
            for (int index = 0; index < entries.length(); index++) {
                JSONObject entry = entries.optJSONObject(index);
                if (entry == null) throw new IOException("备份中的应用文件索引无效。");
                String path = normalizeCompleteBackupManagedPath(entry.optString("path", null));
                long size = entry.optLong("size", -1);
                if (path == null || size < 0 || !indexed.add(path)) {
                    throw new IOException("备份中的应用文件索引无效。");
                }
                File file = new File(stagedFiles, path);
                String canonicalPath = file.getCanonicalPath();
                if (!canonicalPath.startsWith(stagedRoot) || !file.isFile() || file.length() != size) {
                    throw new IOException("ZIP 备份缺少应用文件或文件大小不符：" + path);
                }
            }
        } catch (JSONException error) {
            throw new IOException("备份中的应用文件索引无效。", error);
        }

        Set<String> extracted = new HashSet<>();
        for (String rootName : COMPLETE_BACKUP_MANAGED_ROOTS) {
            File root = new File(stagedFiles, rootName);
            if (root.exists()) collectStagedBackupFiles(stagedFiles, root, extracted);
        }
        if (!indexed.equals(extracted)) {
            throw new IOException("ZIP 备份中的应用文件与索引不一致。");
        }
    }

    private void collectStagedBackupFiles(File stagedRoot, File directory, Set<String> paths) throws IOException {
        File[] children = directory.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) {
                collectStagedBackupFiles(stagedRoot, child, paths);
            } else if (child.isFile()) {
                String rootPath = stagedRoot.getCanonicalPath() + File.separator;
                String childPath = child.getCanonicalPath();
                if (!childPath.startsWith(rootPath)) throw new IOException("ZIP 应用文件路径越界。");
                String relativePath = childPath.substring(rootPath.length()).replace(File.separatorChar, '/');
                String safePath = normalizeCompleteBackupManagedPath(relativePath);
                if (safePath == null || !paths.add(safePath)) {
                    throw new IOException("ZIP 应用文件路径非法。");
                }
            }
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

    private static boolean isTavernStorageModule(String path) {
        return "/script.js".equals(path) || "/scripts/extensions.js".equals(path);
    }

    private static String tavernProxyUrl(String remote) throws IOException {
        return "/api/tavern-module-proxy?url=" + URLEncoder.encode(remote, "UTF-8") + "&v=2";
    }

    private String rewriteTavernModule(String source, String remote) throws IOException {
        Pattern imports = Pattern.compile("(\\b(?:from|import)\\s*(?:\\(\\s*)?)(['\"])((?:/|\\.{1,2}/|https://)[^'\"\\s]+)\\2");
        Matcher matcher = imports.matcher(source);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String path = matcher.group(3);
            String resolved;
            if (isTavernStorageModule(path)) {
                resolved = path;
            } else if (path.endsWith("/data/storage/script.js")) {
                resolved = "/script.js";
            } else if (path.endsWith("/data/storage/scripts/extensions.js")) {
                resolved = "/scripts/extensions.js";
            } else {
                String absolute = URI.create(remote).resolve(path).toString();
                resolved = isTavernModuleUrl(absolute) ? tavernProxyUrl(absolute) : absolute;
            }
            // Modules execute from srcdoc; use an absolute local URL for nested module imports.
            if (resolved.startsWith("/")) resolved = "http://127.0.0.1:" + serverSocket.getLocalPort() + resolved;
            matcher.appendReplacement(result, Matcher.quoteReplacement(matcher.group(1) + matcher.group(2) + resolved + matcher.group(2)));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private static boolean isTavernModuleUrl(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equals(uri.getScheme()) && Arrays.asList("testingcf.jsdelivr.net", "cdn.jsdelivr.net", "fastly.jsdelivr.net", "gcore.jsdelivr.net").contains(uri.getHost());
        } catch (Exception ignored) { return false; }
    }

    private void serveTavernModule(Request request, OutputStream output) throws IOException {
        if (!"GET".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }
        String remote = "";
        String query = URI.create(request.target).getRawQuery();
        if (query != null) for (String pair : query.split("&")) {
            if (pair.startsWith("url=")) remote = URLDecoder.decode(pair.substring(4), "UTF-8");
        }
        if (!isTavernModuleUrl(remote)) {
            sendJson(output, 400, jsonError("Only jsDelivr modules are supported"));
            return;
        }
        String fallback = remote.replaceFirst("https://[^/]+", "https://cdn.jsdelivr.net");
        for (String candidate : new String[] {remote, fallback}) {
            HttpURLConnection connection = null;
            try {
                connection = openConnection(candidate, "", "text/javascript");
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) continue;
                String source = new String(readConnectionBody(connection, status), StandardCharsets.UTF_8);
                sendBytes(output, 200, "text/javascript;charset=utf-8", rewriteTavernModule(source, candidate).getBytes(StandardCharsets.UTF_8));
                return;
            } catch (IOException ignored) {
            } finally { if (connection != null) connection.disconnect(); }
        }
        sendJson(output, 502, jsonError("Tavern module download failed"));
    }

    private File tavernFile(String value) throws IOException {
        String name = value.replaceFirst("^/?(?:user/)?files/", "");
        if (!name.matches("[^\\\\/<>:\"|?*\\x00-\\x1f]{1,200}") || name.startsWith(".") || name.endsWith(".") || name.endsWith(" ")) {
            throw new IOException("Invalid Tavern file name");
        }
        return new File(new File(context.getFilesDir(), "tavern-files"), name);
    }

    private void serveTavernFile(Request request, OutputStream output) throws IOException {
        if (!"GET".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }
        File file = tavernFile(request.path.substring("/user/files/".length()));
        AtomicFile atomic = new AtomicFile(file);
        try (InputStream input = atomic.openRead()) {
            sendBytes(output, 200, "application/octet-stream", readAll(input));
        } catch (IOException error) {
            sendJson(output, 404, jsonError("File not found"));
        }
    }

    private synchronized void handleTavernFile(Request request, OutputStream output) throws IOException, JSONException {
        if (!"POST".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }
        JSONObject body = parseJson(request.body);
        File file;
        try { file = tavernFile(body.optString("name", body.optString("path", ""))); }
        catch (IOException error) { sendJson(output, 400, jsonError(error.getMessage())); return; }
        AtomicFile atomic = new AtomicFile(file);
        if (request.path.endsWith("/delete")) {
            atomic.delete();
            sendJson(output, 200, new JSONObject().put("ok", true));
            return;
        }
        byte[] bytes;
        String base64 = body.optString("data", "");
        if (base64.length() % 4 != 0 || !base64.matches("[A-Za-z0-9+/]*={0,2}")) {
            sendJson(output, 400, jsonError("Invalid base64 file data"));
            return;
        }
        bytes = Base64.decode(base64, Base64.DEFAULT);
        FileOutputStream stream = null;
        try {
            stream = atomic.startWrite();
            stream.write(bytes);
            atomic.finishWrite(stream);
        } catch (IOException error) {
            atomic.failWrite(stream);
            throw error;
        }
        sendJson(output, 200, new JSONObject().put("path", "user/files/" + file.getName()));
    }

    private boolean isCompleteBackupManagedRoot(String root) {
        for (String allowed : COMPLETE_BACKUP_MANAGED_ROOTS) {
            if (allowed.equals(root)) return true;
        }
        return false;
    }

    private String normalizeCompleteBackupManagedPath(String value) {
        if (value == null || value.isEmpty()) return null;
        String normalized = value.replace('\\', '/');
        if (normalized.startsWith("/")) return null;
        String[] parts = normalized.split("/", -1);
        if (parts.length < 2 || !isCompleteBackupManagedRoot(parts[0])) return null;
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)
                    || part.matches(".*[<>:\"|?*\\x00-\\x1f].*")
                    || part.endsWith(".") || part.endsWith(" ")
                    || part.matches("(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\.|$).*$")) {
                return null;
            }
        }
        return normalized;
    }

    private String queryParameter(String target, String name) {
        try {
            String query = URI.create(target).getRawQuery();
            if (query == null) return null;
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                String key = URLDecoder.decode(separator >= 0 ? part.substring(0, separator) : part, "UTF-8");
                if (name.equals(key)) {
                    return URLDecoder.decode(separator >= 0 ? part.substring(separator + 1) : "", "UTF-8");
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private void collectCompleteBackupManagedFiles(File root, File directory, String relativeDirectory, JSONArray files) throws IOException, JSONException {
        File[] children = directory.listFiles();
        if (children == null) return;
        String canonicalRoot = root.getCanonicalPath() + File.separator;
        for (File child : children) {
            String canonicalChild = child.getCanonicalPath();
            if (!canonicalChild.startsWith(canonicalRoot)) continue;
            String relativePath = relativeDirectory + "/" + child.getName();
            if (child.isDirectory()) {
                collectCompleteBackupManagedFiles(root, child, relativePath, files);
            } else if (child.isFile()) {
                String safePath = normalizeCompleteBackupManagedPath(relativePath);
                if (safePath != null) {
                    files.put(new JSONObject().put("path", safePath).put("size", child.length()));
                }
            }
        }
    }

    private JSONArray listCompleteBackupManagedFiles() throws IOException, JSONException {
        JSONArray files = new JSONArray();
        for (String name : COMPLETE_BACKUP_MANAGED_ROOTS) {
            File root = new File(context.getFilesDir(), name);
            if (root.isDirectory()) collectCompleteBackupManagedFiles(root, root, name, files);
        }
        return files;
    }

    private void serveCompleteBackupManagedFile(Request request, OutputStream output) throws IOException, JSONException {
        if (!"GET".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }
        String relativePath = normalizeCompleteBackupManagedPath(queryParameter(request.target, "path"));
        if (relativePath == null) {
            sendJson(output, 400, jsonError("应用文件路径非法。"));
            return;
        }
        String[] parts = relativePath.split("/");
        File root = new File(context.getFilesDir(), parts[0]);
        File file = new File(root, relativePath.substring(parts[0].length() + 1));
        String rootPath = root.getCanonicalPath() + File.separator;
        String filePath = file.getCanonicalPath();
        if (!filePath.startsWith(rootPath) || !file.isFile()) {
            sendJson(output, 404, jsonError("应用文件不存在。"));
            return;
        }
        writeHead(output, 200, "application/octet-stream", file.length());
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    private void serveSessionImage(Request request, OutputStream output) throws IOException, JSONException {
        String[] parts = request.path.substring("/api/session-images/".length()).split("/", -1);
        if (parts.length == 0 || !parts[0].matches("[A-Za-z0-9_-]{1,128}")) {
            sendJson(output, 400, jsonError("非法 sessionId"));
            return;
        }
        File root = new File(context.getFilesDir(), "session-images");
        File sessionDirectory = new File(root, parts[0]);
        if (parts.length == 1 && "DELETE".equals(request.method)) {
            deleteRecursively(sessionDirectory);
            sendJson(output, 200, new JSONObject().put("ok", true));
            return;
        }
        if (parts.length != 2 || !"GET".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }
        if (!parts[1].matches("[A-Za-z0-9._-]{1,200}")) {
            sendJson(output, 400, jsonError("非法文件名"));
            return;
        }
        File file = new File(sessionDirectory, parts[1]);
        String rootPath = sessionDirectory.getCanonicalPath() + File.separator;
        String filePath = file.getCanonicalPath();
        if (!filePath.startsWith(rootPath) || !file.isFile()) {
            sendJson(output, 404, jsonError("图片不存在"));
            return;
        }
        writeHead(output, 200, mimeType(file.getName()), file.length());
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    private void handleApi(Request request, OutputStream output) throws IOException, JSONException {
        if ("/api/characters/chats".equals(request.path)) {
            if (!"POST".equals(request.method)) { sendJson(output, 405, jsonError("Method not allowed")); return; }
            JSONObject body = parseJson(request.body);
            JSONObject data;
            try (InputStream input = new AtomicFile(appDataFile).openRead()) {
                data = new JSONObject(new String(readAll(input), StandardCharsets.UTF_8));
            }
            JSONArray cards = data.optJSONArray("characterCards");
            String cardId = "";
            String avatar = body.optString("avatar_url", "");
            if (cards != null) for (int index = 0; index < cards.length(); index++) {
                JSONObject card = cards.optJSONObject(index);
                if (card != null && (avatar.equals(card.optString("avatarDataUrl")) || avatar.equals(card.optString("id") + ".png"))) {
                    cardId = card.optString("id"); break;
                }
            }
            JSONArray result = new JSONArray();
            JSONArray chats = data.optJSONArray("chatSessions");
            if (!cardId.isEmpty() && chats != null) for (int index = 0; index < chats.length(); index++) {
                JSONObject chat = chats.optJSONObject(index);
                if (chat != null && cardId.equals(chat.optString("roleplayCharacterCardId"))) result.put(new JSONObject().put("file_name", chat.optString("id") + ".jsonl"));
            }
            sendBytes(output, 200, "application/json;charset=utf-8", result.toString().getBytes(StandardCharsets.UTF_8));
            return;
        }
        if ("/api/backends/chat-completions/generate".equals(request.path) || "/api/backends/chat-completions/status".equals(request.path)) {
            handleTavernCompletion(request, output);
            return;
        }
        if ("/api/tavern-module-proxy".equals(request.path)) {
            serveTavernModule(request, output);
            return;
        }
        if ("/api/files/upload".equals(request.path) || "/api/files/delete".equals(request.path)) {
            handleTavernFile(request, output);
            return;
        }
        if ("/api/app-data/backup-files".equals(request.path)) {
            if (!"GET".equals(request.method)) {
                sendJson(output, 405, jsonError("Method not allowed"));
                return;
            }
            sendBytes(output, 200, "application/json;charset=utf-8",
                    new JSONObject().put("files", listCompleteBackupManagedFiles()).toString().getBytes(StandardCharsets.UTF_8));
            return;
        }
        if ("/api/app-data/backup-file".equals(request.path)) {
            serveCompleteBackupManagedFile(request, output);
            return;
        }
        if (request.path.startsWith("/api/session-images/")) {
            serveSessionImage(request, output);
            return;
        }
        if (request.path.startsWith("/api/app-data/assets/")) {
            if (!"GET".equals(request.method)) {
                sendJson(output, 405, jsonError("Method not allowed"));
                return;
            }
            serveAppDataAsset(request.path, output);
            return;
        }
        if ("/api/app-data".equals(request.path)) {
            handleAppData(request, output);
            return;
        }

        if ("/api/pi/session".equals(request.path)) {
            if (!"DELETE".equals(request.method)) {
                sendJson(output, 405, jsonError("Method not allowed"));
                return;
            }
            JSONObject body = parseJson(request.body);
            String sessionId = body.optString("sessionId", "").trim();
            if (!sessionId.isEmpty()) piSessions.remove(sessionId);
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            sendJson(output, 200, payload);
            return;
        }

        if (!"POST".equals(request.method)) {
            sendJson(output, 405, jsonError("Method not allowed"));
            return;
        }

        JSONObject body = parseJson(request.body);

        if ("/api/pi/tool-result".equals(request.path)) {
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            sendJson(output, 200, payload);
            return;
        }

        if ("/api/pi/abort".equals(request.path)) {
            String runId = body.optString("runId", "").trim();
            HttpURLConnection connection = activePiRuns.remove(runId);
            if (connection != null) connection.disconnect();
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("aborted", connection != null);
            sendJson(output, 200, payload);
            return;
        }

        if ("/api/pi/set-auto-compaction".equals(request.path)) {
            PiSessionState state = getPiSessionState(body);
            state.autoCompactionEnabled = body.optBoolean("enabled", true);
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("enabled", state.autoCompactionEnabled);
            sendJson(output, 200, payload);
            return;
        }

        if ("/api/pi/compact".equals(request.path)) {
            PiSessionState state = getPiSessionState(body);
            state.compactionCount += 1;
            JSONObject payload = new JSONObject();
            payload.put("ok", true);
            payload.put("result", "Android Pi 兼容会话已标记为压缩；下一轮将以客户端整理后的完整上下文继续。");
            payload.put("contextUsage", state.contextUsage());
            sendJson(output, 200, payload);
            return;
        }

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

            JSONObject providerRequest = "responses".equals(target.apiType)
                    ? buildResponsesApiRequest(upstreamRequest)
                    : upstreamRequest;
            String endpoint = "responses".equals(target.apiType)
                    ? "/responses"
                    : "/chat/completions";

            if (providerRequest.optBoolean("stream", false)) {
                proxyStream(output, target.apiBaseUrl + endpoint, target.apiKey, providerRequest);
            } else {
                proxyJson(output, target.apiBaseUrl + endpoint, target.apiKey, "POST", providerRequest);
            }
            return;
        }

        if ("/api/pi/chat".equals(request.path)) {
            proxyPiChat(output, target, body);
            return;
        }

        sendJson(output, 404, jsonError("Not found"));
    }

    private PiSessionState getPiSessionState(JSONObject body) {
        String sessionId = body.optString("sessionId", "").trim();
        if (sessionId.isEmpty()) sessionId = body.optString("runId", "android-pi-session").trim();
        if (sessionId.isEmpty()) sessionId = "android-pi-session";
        return piSessions.computeIfAbsent(sessionId, ignored -> new PiSessionState());
    }

    private void handleAppData(Request request, OutputStream output) throws IOException, JSONException {
        if ("GET".equals(request.method)) {
            sendAppData(output);
            return;
        }

        if ("PUT".equals(request.method)
                || "POST".equals(request.method)
                || "PATCH".equals(request.method)) {
            JSONObject body = parseJson(request.body);
            Object data = body.has("data") ? body.get("data") : body;
            if ("PATCH".equals(request.method)) {
                patchAppData(data);
            } else {
                writeAppData(data);
            }

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

    private void serveAppDataAsset(String requestPath, OutputStream output) throws IOException {
        String relativePath = requestPath.substring("/api/app-data/assets/".length());
        if (relativePath.isEmpty() || !isSupportedImageAsset(relativePath)) {
            sendJson(output, 404, jsonError("Not found"));
            return;
        }
        File assetFile = new File(appDataAssetsDirectory, relativePath);
        String assetsCanonicalPath = appDataAssetsDirectory.getCanonicalPath() + File.separator;
        if (!assetFile.getCanonicalPath().startsWith(assetsCanonicalPath)) {
            sendJson(output, 403, jsonError("Forbidden"));
            return;
        }
        if (!assetFile.isFile()) {
            sendJson(output, 404, jsonError("Not found"));
            return;
        }
        writeHead(output, 200, mimeType(assetFile.getName()), assetFile.length());
        try (InputStream input = new BufferedInputStream(new FileInputStream(assetFile))) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    private boolean isSupportedImageAsset(String path) {
        String lower = path.toLowerCase(Locale.US);
        return lower.endsWith(".png")
                || lower.endsWith(".jpg")
                || lower.endsWith(".jpeg")
                || lower.endsWith(".webp")
                || lower.endsWith(".gif")
                || lower.endsWith(".bmp")
                || lower.endsWith(".apng")
                || lower.endsWith(".svg")
                || lower.endsWith(".ico")
                || lower.endsWith(".avif")
                || lower.endsWith(".heic")
                || lower.endsWith(".heif")
                || lower.endsWith(".tif")
                || lower.endsWith(".tiff");
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
            if (appDataAssetsBackupDirectory.exists()) {
                if (appDataAssetsDirectory.exists()) deleteRecursively(appDataAssetsDirectory);
                if (!appDataAssetsBackupDirectory.renameTo(appDataAssetsDirectory)) {
                    throw new IOException("无法恢复上一版图片资源。");
                }
            }
            if (appDataManagedBackupDirectory.exists()) {
                for (String root : COMPLETE_BACKUP_MANAGED_ROOTS) {
                    File current = new File(context.getFilesDir(), root);
                    File previous = new File(appDataManagedBackupDirectory, root);
                    if (current.exists()) deleteRecursively(current);
                    if (previous.exists() && !previous.renameTo(current)) {
                        throw new IOException("无法恢复上一版应用文件：" + root);
                    }
                }
                deleteRecursively(appDataManagedBackupDirectory);
            }
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
            if (appDataFile.isFile()
                    && appDataFile.length() > 0
                    && !appDataAssetsDirectory.exists()) {
                copyFileAtomically(appDataFile, appDataBackupFile);
            }
            writeJsonAtomically(appDataFile, normalized.toString());
        } catch (JSONException error) {
            throw new IOException(error);
        }
    }

    private synchronized void patchAppData(Object data) throws IOException {
        try {
            JSONObject patch = data instanceof JSONObject
                    ? (JSONObject) data
                    : new JSONObject(String.valueOf(data));
            JSONObject current = new JSONObject();
            File source = appDataFile.isFile() && appDataFile.length() > 0
                    ? appDataFile
                    : appDataBackupFile;
            if (source.isFile() && source.length() > 0) {
                try (InputStream input = new BufferedInputStream(new FileInputStream(source))) {
                    current = new JSONObject(new String(readAll(input), StandardCharsets.UTF_8));
                }
            }
            Iterator<String> keys = patch.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                current.put(key, patch.get(key));
            }
            writeAppData(current);
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
        deleteRecursively(appDataAssetsDirectory);
        deleteRecursively(appDataAssetsBackupDirectory);
        deleteRecursively(appDataManagedBackupDirectory);
        WebStorage.getInstance().deleteAllData();
        boolean preferencesCleared = context.getSharedPreferences("renge_android_workspace", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit();
        if (!preferencesCleared) throw new IOException("无法清除 Android 工作区设置。");
        for (String name : COMPLETE_BACKUP_MANAGED_ROOTS) {
            deleteRecursively(new File(context.getFilesDir(), name));
        }
    }

    private JSONObject tavernObject(Object value) throws JSONException {
        if (value instanceof JSONObject) return (JSONObject) value;
        if (value == null || value == JSONObject.NULL || value.toString().trim().isEmpty()) return new JSONObject();
        Object parsed = new Yaml(new SafeConstructor(new LoaderOptions())).load(value.toString());
        if (parsed instanceof Map) return new JSONObject((Map<?, ?>) parsed);
        JSONObject result = new JSONObject();
        if (parsed instanceof Iterable) {
            for (Object part : (Iterable<?>) parsed) if (part instanceof Map) {
                JSONObject fields = new JSONObject((Map<?, ?>) part);
                for (Iterator<String> keys = fields.keys(); keys.hasNext();) {
                    String key = keys.next();
                    result.put(key, fields.get(key));
                }
            }
            return result;
        }
        throw new JSONException("Tavern options must be a YAML object");
    }

    private String firstTavernValue(JSONObject body, String... fields) {
        for (String field : fields) {
            String value = body.optString(field, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private void handleTavernCompletion(Request request, OutputStream output) throws IOException, JSONException {
        if (!"POST".equals(request.method)) { sendJson(output, 405, jsonError("Method not allowed")); return; }
        JSONObject body = parseJson(request.body);
        String base = firstTavernValue(body, "reverse_proxy", "custom_url", "apiBaseUrl", "apiurl").replaceAll("/+$", "").replaceFirst("/(?:chat/completions|models)$", "");
        if (!(base.startsWith("https://") || base.startsWith("http://"))) {
            sendJson(output, 400, jsonError("Missing provider URL")); return;
        }
        JSONObject headers = tavernObject(body.opt("custom_include_headers"));
        String key = firstTavernValue(body, "proxy_password", "apiKey", "api_key", "key");
        JSONObject upstream = new JSONObject();
        copyJsonFields(body, upstream, new String[] {"model", "messages", "max_tokens", "max_completion_tokens", "temperature", "top_p", "frequency_penalty", "presence_penalty", "seed", "stop", "stream", "stream_options", "tools", "tool_choice", "response_format", "reasoning_effort", "logit_bias", "n"});
        mergeTavernObject(upstream, tavernObject(body.opt("custom_include_body")));
        Object excluded = body.opt("custom_exclude_body");
        if (excluded != null && excluded != JSONObject.NULL && !excluded.toString().trim().isEmpty()) {
            Object parsed = new Yaml(new SafeConstructor(new LoaderOptions())).load(excluded.toString());
            if (parsed instanceof Iterable) {
                for (Object path : (Iterable<?>) parsed) deleteTavernPath(upstream, String.valueOf(path));
            } else {
                for (String path : excluded.toString().split("[,\\n]")) deleteTavernPath(upstream, path.trim());
            }
        }
        boolean status = request.path.endsWith("/status");
        HttpURLConnection connection = openConnection(base + (status ? "/models" : "/chat/completions"), key, upstream.optBoolean("stream") ? "text/event-stream" : "application/json");
        try {
            if (!status && upstream.optBoolean("stream")) connection.setReadTimeout(0);
            connection.setRequestMethod(status ? "GET" : "POST");
            for (Iterator<String> names = headers.keys(); names.hasNext();) {
                String name = names.next();
                if (!name.matches("(?i)host|content-length|connection|transfer-encoding|cookie")) connection.setRequestProperty(name, headers.getString(name));
            }
            if (!status) {
                connection.setDoOutput(true);
                try (OutputStream destination = connection.getOutputStream()) { destination.write(upstream.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int code = connection.getResponseCode();
            if (!status && upstream.optBoolean("stream") && code >= 200 && code < 300) {
                writeHead(output, code, "text/event-stream;charset=utf-8", -1);
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); output.flush(); }
                }
            } else {
                sendBytes(output, code, "application/json;charset=utf-8", readConnectionBody(connection, code));
            }
        } finally { connection.disconnect(); }
    }

    private void mergeTavernObject(JSONObject target, JSONObject patch) throws JSONException {
        for (Iterator<String> keys = patch.keys(); keys.hasNext();) {
            String key = keys.next();
            if (target.opt(key) instanceof JSONObject && patch.opt(key) instanceof JSONObject) {
                mergeTavernObject(target.getJSONObject(key), patch.getJSONObject(key));
            } else { target.put(key, patch.get(key)); }
        }
    }

    private void deleteTavernPath(JSONObject target, String path) {
        String[] parts = path.split("\\.");
        for (int index = 0; index < parts.length - 1; index++) {
            target = target.optJSONObject(parts[index]);
            if (target == null) return;
        }
        if (parts.length > 0) target.remove(parts[parts.length - 1]);
    }

    private ProviderTarget getProviderTarget(JSONObject body) throws JSONException {
        String apiBaseUrl = body.optString("apiBaseUrl", "").trim().replaceAll("/+$", "");
        String apiKey = body.optString("apiKey", "");
        String apiType = normalizeProviderApiType(body.optString("apiType", ""));
        if (apiBaseUrl.isEmpty()) {
            throw new JSONException("缺少 apiBaseUrl");
        }
        return new ProviderTarget(apiBaseUrl, apiKey, apiType);
    }

    private String normalizeProviderApiType(String value) {
        String normalized = value == null
                ? ""
                : value.trim().toLowerCase(Locale.US).replaceAll("[_\\s]+", "-");
        return "responses".equals(normalized) || "responses-api".equals(normalized)
                ? "responses"
                : "chat-completions";
    }

    private void copyJsonFields(JSONObject source, JSONObject target, String[] keys) throws JSONException {
        for (String key : keys) {
            if (source.has(key)) target.put(key, source.get(key));
        }
    }

    private Object convertResponsesInputContent(Object rawContent) throws JSONException {
        if (!(rawContent instanceof JSONArray)) return rawContent;
        JSONArray source = (JSONArray) rawContent;
        JSONArray content = new JSONArray();
        for (int index = 0; index < source.length(); index += 1) {
            JSONObject part = source.optJSONObject(index);
            if (part == null) continue;
            String type = part.optString("type", "");
            if ("text".equals(type) || "output_text".equals(type)) {
                if (part.has("text")) {
                    JSONObject inputText = new JSONObject();
                    inputText.put("type", "input_text");
                    inputText.put("text", part.optString("text", ""));
                    content.put(inputText);
                }
            } else if ("image_url".equals(type)) {
                Object rawImageUrl = part.opt("image_url");
                String imageUrl = rawImageUrl instanceof JSONObject
                        ? ((JSONObject) rawImageUrl).optString("url", "")
                        : String.valueOf(rawImageUrl == null ? "" : rawImageUrl);
                if (!imageUrl.isEmpty()) {
                    JSONObject inputImage = new JSONObject();
                    inputImage.put("type", "input_image");
                    inputImage.put("image_url", imageUrl);
                    if (rawImageUrl instanceof JSONObject) {
                        String detail = ((JSONObject) rawImageUrl).optString("detail", "");
                        if (!detail.isEmpty()) inputImage.put("detail", detail);
                    }
                    content.put(inputImage);
                }
            } else if (
                    "input_text".equals(type)
                            || "input_image".equals(type)
                            || "input_file".equals(type)
            ) {
                content.put(new JSONObject(part.toString()));
            }
        }
        return content;
    }

    private boolean hasResponsesMessageContent(Object content) {
        if (content instanceof String) return !((String) content).isEmpty();
        return content instanceof JSONArray && ((JSONArray) content).length() > 0;
    }

    private String jsonValueAsText(Object value) {
        if (value == null || value == JSONObject.NULL) return "";
        return value instanceof String ? (String) value : String.valueOf(value);
    }

    private JSONArray convertResponsesInput(JSONArray messages) throws JSONException {
        JSONArray input = new JSONArray();
        if (messages == null) return input;

        for (int index = 0; index < messages.length(); index += 1) {
            JSONObject source = messages.optJSONObject(index);
            if (source == null) continue;
            String role = source.optString("role", "user");
            Object rawContent = source.has("content") ? source.get("content") : JSONObject.NULL;
            Object content = convertResponsesInputContent(rawContent);

            if ("tool".equals(role)) {
                String callId = source.optString("tool_call_id", "").trim();
                if (!callId.isEmpty()) {
                    JSONObject outputItem = new JSONObject();
                    outputItem.put("type", "function_call_output");
                    outputItem.put("call_id", callId);
                    outputItem.put("output", jsonValueAsText(rawContent));
                    input.put(outputItem);
                }
                continue;
            }

            if ("assistant".equals(role)) {
                JSONArray reasoningItems = source.optJSONArray("responses_reasoning_items");
                if (reasoningItems != null) {
                    for (int reasoningIndex = 0; reasoningIndex < reasoningItems.length(); reasoningIndex += 1) {
                        JSONObject reasoningItem = reasoningItems.optJSONObject(reasoningIndex);
                        if (reasoningItem != null && "reasoning".equals(reasoningItem.optString("type", ""))) {
                            input.put(new JSONObject(reasoningItem.toString()));
                        }
                    }
                }
                if (hasResponsesMessageContent(content)) {
                    JSONObject assistantMessage = new JSONObject();
                    assistantMessage.put("role", "assistant");
                    assistantMessage.put("content", content);
                    input.put(assistantMessage);
                }
                JSONArray toolCalls = source.optJSONArray("tool_calls");
                if (toolCalls != null) {
                    for (int toolIndex = 0; toolIndex < toolCalls.length(); toolIndex += 1) {
                        JSONObject toolCall = toolCalls.optJSONObject(toolIndex);
                        JSONObject function = toolCall == null ? null : toolCall.optJSONObject("function");
                        if (function == null) continue;
                        String callId = toolCall.optString("id", "").trim();
                        String name = function.optString("name", "").trim();
                        if (callId.isEmpty() || name.isEmpty()) continue;
                        JSONObject callItem = new JSONObject();
                        callItem.put("type", "function_call");
                        callItem.put("call_id", callId);
                        callItem.put("name", name);
                        callItem.put("arguments", jsonValueAsText(function.opt("arguments")));
                        input.put(callItem);
                    }
                }
                continue;
            }

            if (hasResponsesMessageContent(content)) {
                JSONObject inputMessage = new JSONObject();
                inputMessage.put(
                        "role",
                        "system".equals(role) || "developer".equals(role) ? role : "user"
                );
                inputMessage.put("content", content);
                input.put(inputMessage);
            }
        }
        return input;
    }

    private JSONArray convertResponsesTools(JSONArray sourceTools) throws JSONException {
        if (sourceTools == null) return null;
        JSONArray tools = new JSONArray();
        for (int index = 0; index < sourceTools.length(); index += 1) {
            JSONObject source = sourceTools.optJSONObject(index);
            if (source == null) continue;
            JSONObject function = "function".equals(source.optString("type", ""))
                    ? source.optJSONObject("function")
                    : null;
            if (function == null) {
                tools.put(new JSONObject(source.toString()));
                continue;
            }
            String name = function.optString("name", "").trim();
            if (name.isEmpty()) continue;
            JSONObject tool = new JSONObject();
            tool.put("type", "function");
            tool.put("name", name);
            if (function.has("description")) tool.put("description", function.get("description"));
            if (function.has("parameters")) tool.put("parameters", function.get("parameters"));
            tool.put("strict", function.optBoolean("strict", false));
            tools.put(tool);
        }
        return tools;
    }

    private Object convertResponsesToolChoice(Object rawToolChoice) throws JSONException {
        if (!(rawToolChoice instanceof JSONObject)) return rawToolChoice;
        JSONObject source = (JSONObject) rawToolChoice;
        if (!"function".equals(source.optString("type", ""))) return rawToolChoice;
        JSONObject function = source.optJSONObject("function");
        String name = function == null
                ? source.optString("name", "")
                : function.optString("name", "");
        if (name.isEmpty()) return rawToolChoice;
        JSONObject toolChoice = new JSONObject();
        toolChoice.put("type", "function");
        toolChoice.put("name", name);
        return toolChoice;
    }

    private JSONObject buildResponsesApiRequest(JSONObject chatRequest) throws JSONException {
        JSONObject request = new JSONObject();
        copyJsonFields(chatRequest, request, new String[]{
                "background", "context_management", "conversation", "include", "instructions",
                "max_tool_calls", "metadata", "model", "moderation", "parallel_tool_calls",
                "previous_response_id", "prompt", "prompt_cache_key", "prompt_cache_options",
                "prompt_cache_retention", "safety_identifier", "service_tier", "store", "stream",
                "temperature", "top_logprobs", "top_p", "truncation", "user"
        });

        request.put(
                "input",
                chatRequest.has("input")
                        ? chatRequest.get("input")
                        : convertResponsesInput(chatRequest.optJSONArray("messages"))
        );

        for (String maxTokensKey : new String[]{
                "max_output_tokens", "max_completion_tokens", "max_tokens"
        }) {
            if (chatRequest.has(maxTokensKey)) {
                request.put("max_output_tokens", chatRequest.get(maxTokensKey));
                break;
            }
        }

        JSONArray tools = convertResponsesTools(
                chatRequest.optJSONArray("tools") != null
                        ? chatRequest.optJSONArray("tools")
                        : chatRequest.optJSONArray("functions")
        );
        if (tools != null) request.put("tools", tools);

        Object rawToolChoice = chatRequest.has("tool_choice")
                ? chatRequest.get("tool_choice")
                : chatRequest.opt("function_call");
        if (rawToolChoice != null) {
            request.put("tool_choice", convertResponsesToolChoice(rawToolChoice));
        }

        JSONObject text = chatRequest.optJSONObject("text") == null
                ? new JSONObject()
                : new JSONObject(chatRequest.optJSONObject("text").toString());
        JSONObject responseFormat = chatRequest.optJSONObject("response_format");
        if (responseFormat != null) {
            String type = responseFormat.optString("type", "");
            JSONObject format = null;
            if ("json_schema".equals(type) && responseFormat.optJSONObject("json_schema") != null) {
                format = new JSONObject(responseFormat.optJSONObject("json_schema").toString());
                format.put("type", "json_schema");
            } else if ("json_object".equals(type) || "text".equals(type)) {
                format = new JSONObject();
                format.put("type", type);
            }
            if (format != null) text.put("format", format);
        }
        if (chatRequest.has("verbosity")) text.put("verbosity", chatRequest.get("verbosity"));
        if (text.length() > 0) request.put("text", text);

        JSONObject reasoning = chatRequest.optJSONObject("reasoning") == null
                ? new JSONObject()
                : new JSONObject(chatRequest.optJSONObject("reasoning").toString());
        if (reasoning.optBoolean("enabled", true) == false && !reasoning.has("effort")) {
            reasoning.put("effort", "none");
        }
        reasoning.remove("enabled");
        if (chatRequest.has("reasoning_effort")) {
            reasoning.put("effort", chatRequest.get("reasoning_effort"));
        }
        if (
                reasoning.has("effort")
                        && !"none".equals(reasoning.optString("effort", ""))
                        && !reasoning.has("summary")
        ) {
            reasoning.put("summary", "auto");
        }
        if (reasoning.length() > 0) request.put("reasoning", reasoning);

        JSONObject streamOptions = chatRequest.optJSONObject("stream_options");
        if (streamOptions != null && streamOptions.has("include_obfuscation")) {
            JSONObject responsesStreamOptions = new JSONObject();
            responsesStreamOptions.put(
                    "include_obfuscation",
                    streamOptions.get("include_obfuscation")
            );
            request.put("stream_options", responsesStreamOptions);
        }
        return request;
    }

    private void proxyPiChat(
            OutputStream output,
            ProviderTarget target,
            JSONObject body
    ) throws IOException, JSONException {
        JSONObject requestBody = body.optJSONObject("request");
        if (requestBody == null) {
            sendJson(output, 400, jsonError("缺少 request"));
            return;
        }

        String runId = body.optString("runId", "").trim();
        if (runId.isEmpty()) runId = "android-pi-" + System.nanoTime();
        JSONObject streamingRequest = new JSONObject(requestBody.toString());
        streamingRequest.put("stream", true);
        JSONObject providerRequest = "responses".equals(target.apiType)
                ? buildResponsesApiRequest(streamingRequest)
                : streamingRequest;
        String endpoint = "responses".equals(target.apiType)
                ? "/responses"
                : "/chat/completions";

        HttpURLConnection connection = openConnection(
                target.apiBaseUrl + endpoint,
                target.apiKey,
                "text/event-stream"
        );
        connection.setReadTimeout(0);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        byte[] requestBytes = providerRequest.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(requestBytes.length);
        try (OutputStream upstreamOutput = connection.getOutputStream()) {
            upstreamOutput.write(requestBytes);
        }

        activePiRuns.put(runId, connection);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                sendBytes(
                        output,
                        status,
                        "application/json;charset=utf-8",
                        readConnectionBody(connection, status)
                );
                return;
            }

            PiSessionState state = getPiSessionState(body);
            state.estimatedTokens = Math.max(1, requestBody.toString().length() / 4L);
            long requestedContextWindow = body.optLong("contextWindow", 128000L);
            state.contextWindow = requestedContextWindow > 0 ? requestedContextWindow : 128000L;

            writeHead(output, 200, "text/event-stream;charset=utf-8", -1);
            JSONObject runStart = new JSONObject();
            runStart.put("type", "run_start");
            runStart.put("runId", runId);
            runStart.put("sessionId", body.optString("sessionId", runId));
            runStart.put("kernel", PI_KERNEL_ID);
            runStart.put("kernelMode", "android-compatible");
            JSONObject compaction = new JSONObject();
            compaction.put("engine", "android-pi-session");
            compaction.put("enabled", state.autoCompactionEnabled);
            runStart.put("compaction", compaction);
            runStart.put("nativeTools", new JSONArray());
            JSONObject mcp = new JSONObject();
            mcp.put("enabled", false);
            runStart.put("mcp", mcp);
            writePiSse(output, wrapPiEvent(runStart));

            String contentType = connection.getContentType();
            boolean upstreamIsEventStream = contentType != null
                    && contentType.toLowerCase(Locale.US).contains("text/event-stream");
            try (InputStream upstreamInput = connection.getInputStream()) {
                if (upstreamIsEventStream) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = upstreamInput.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                        output.flush();
                    }
                } else {
                    byte[] responseBody = readAll(upstreamInput);
                    writePiSse(output, new String(responseBody, StandardCharsets.UTF_8));
                }
            }

            JSONObject usage = new JSONObject();
            usage.put("type", "context_usage");
            usage.put("runId", runId);
            usage.put("usage", state.contextUsage());
            writePiSse(output, wrapPiEvent(usage));
            writePiSse(output, "[DONE]");
        } finally {
            activePiRuns.remove(runId, connection);
            connection.disconnect();
        }
    }

    private JSONObject wrapPiEvent(JSONObject event) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("pi", event);
        return payload;
    }

    private void writePiSse(OutputStream output, Object payload) throws IOException {
        String serialized = payload instanceof String
                ? (String) payload
                : String.valueOf(payload);
        output.write(("data: " + serialized + "\n\n").getBytes(StandardCharsets.UTF_8));
        output.flush();
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
        connection.setReadTimeout(0);
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
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".apng")) return "image/apng";
        if (lower.endsWith(".avif")) return "image/avif";
        if (lower.endsWith(".heic")) return "image/heic";
        if (lower.endsWith(".heif")) return "image/heif";
        if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
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
        final String target;
        final Map<String, String> headers;
        final long contentLength;
        final byte[] body;

        Request(
                String method,
                String path,
                String target,
                Map<String, String> headers,
                long contentLength,
                byte[] body
        ) {
            this.method = method;
            this.path = path;
            this.target = target;
            this.headers = headers;
            this.contentLength = contentLength;
            this.body = body;
        }

        Request withBody(byte[] nextBody) {
            return new Request(method, path, target, headers, contentLength, nextBody);
        }
    }

    private static final class CompleteBackupMetadata {
        final String exportedAt;
        final int version;
        final JSONObject localStorage;

        CompleteBackupMetadata(String exportedAt, int version, JSONObject localStorage) {
            this.exportedAt = exportedAt;
            this.version = version;
            this.localStorage = localStorage;
        }
    }

    private static final class ProviderTarget {
        final String apiBaseUrl;
        final String apiKey;
        final String apiType;

        ProviderTarget(String apiBaseUrl, String apiKey, String apiType) {
            this.apiBaseUrl = apiBaseUrl;
            this.apiKey = apiKey;
            this.apiType = apiType;
        }
    }

    private static final class PiSessionState {
        volatile boolean autoCompactionEnabled = true;
        volatile long estimatedTokens;
        volatile long contextWindow = 128000L;
        volatile int compactionCount;

        JSONObject contextUsage() throws JSONException {
            JSONObject usage = new JSONObject();
            usage.put("tokens", estimatedTokens);
            usage.put("contextWindow", contextWindow);
            usage.put(
                    "percent",
                    contextWindow > 0 ? (estimatedTokens * 100.0d) / contextWindow : JSONObject.NULL
            );
            usage.put("compactionCount", compactionCount);
            return usage;
        }
    }
}
