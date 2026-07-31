package com.renge.agentlab;

import android.app.Activity;

import com.termux.terminal.RengePtyProcess;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class AndroidTerminalManager {
    static final class LaunchConfig {
        final String cwd;
        final boolean root;

        LaunchConfig(String cwd, boolean root) {
            this.cwd = cwd;
            this.root = root;
        }
    }

    interface LaunchConfigProvider {
        LaunchConfig getLaunchConfig();
    }

    interface EventSink {
        void emit(String eventName, JSONObject payload);
    }

    private static final int MAX_BUFFER_CHARS = 2 * 1024 * 1024;
    private static final int MAX_READ_CHARS = 100_000;
    private static final int MAX_SESSIONS = 12;

    private final Object sessionsLock = new Object();
    private final Activity activity;
    private final LaunchConfigProvider launchConfigProvider;
    private final EventSink eventSink;
    private final Map<String, Session> sessions = new LinkedHashMap<>();

    AndroidTerminalManager(
            Activity activity,
            LaunchConfigProvider launchConfigProvider,
            EventSink eventSink
    ) {
        this.activity = activity;
        this.launchConfigProvider = launchConfigProvider;
        this.eventSink = eventSink;
    }

    JSONArray list(JSONObject options) throws JSONException {
        boolean includeBuffer = !options.has("includeBuffer") || options.optBoolean("includeBuffer", true);
        List<Session> snapshot;
        synchronized (sessionsLock) {
            snapshot = new ArrayList<>(sessions.values());
        }
        JSONArray result = new JSONArray();
        for (Session session : snapshot) result.put(serialize(session, includeBuffer));
        return result;
    }

    JSONObject create(JSONObject options) throws Exception {
        Session session;
        synchronized (sessionsLock) {
            if (sessions.size() >= MAX_SESSIONS) {
                throw new IllegalStateException("最多同时打开 " + MAX_SESSIONS + " 个终端");
            }
            LaunchConfig config = launchConfigProvider.getLaunchConfig();
            String id = UUID.randomUUID().toString();
            String requestedTitle = options.optString("title", "").trim();
            String title = requestedTitle.isEmpty()
                    ? "终端 " + (sessions.size() + 1)
                    : requestedTitle.substring(0, Math.min(80, requestedTitle.length()));
            session = new Session(id, title, config.cwd, config.root);
            sessions.put(id, session);
        }

        try {
            spawn(session, options);
        } catch (Exception error) {
            synchronized (sessionsLock) {
                sessions.remove(session.id);
            }
            throw error;
        }
        JSONObject payload = serialize(session, true);
        eventSink.emit("created", payload);
        return payload;
    }

    JSONObject write(JSONObject options) throws Exception {
        Session session = getSession(options.optString("id", ""));
        String data = options.optString("data", "");
        if (data.length() > 1024 * 1024) throw new IllegalArgumentException("单次终端输入过长");
        RengePtyProcess process;
        synchronized (session) {
            process = session.process;
            if (process == null || session.exited || !process.isRunning()) {
                throw new IllegalStateException("终端进程已经退出");
            }
        }
        process.write(data);
        return new JSONObject().put("ok", true);
    }

    JSONObject resize(JSONObject options) throws Exception {
        Session session = getSession(options.optString("id", ""));
        int columns = clampDimension(options.optInt("cols", 80), 80, 500);
        int rows = clampDimension(options.optInt("rows", 24), 24, 300);
        synchronized (session) {
            if (session.process != null && !session.exited) session.process.resize(columns, rows);
        }
        return new JSONObject().put("ok", true);
    }

    JSONObject read(JSONObject options) throws Exception {
        Session session = getSession(options.optString("id", ""));
        int maxChars = clampDimension(options.optInt("maxChars", 20_000), 20_000, MAX_READ_CHARS);
        synchronized (session) {
            long bufferStart = Math.max(0L, session.outputOffset - session.buffer.length());
            boolean hasFrom = options.has("from") && options.optDouble("from", -1) >= 0;
            long requestedFrom = hasFrom
                    ? (long) Math.min(Long.MAX_VALUE, Math.floor(options.optDouble("from", 0)))
                    : -1;
            long start = hasFrom
                    ? Math.min(session.outputOffset, Math.max(bufferStart, requestedFrom))
                    : Math.max(bufferStart, session.outputOffset - maxChars);
            int bufferIndex = (int) Math.max(0L, start - bufferStart);
            int end = Math.min(session.buffer.length(), bufferIndex + maxChars);
            String output = session.buffer.substring(bufferIndex, end);
            JSONObject payload = serializeLocked(session, false);
            payload.put("output", output);
            payload.put("cursor", start);
            payload.put("nextCursor", start + output.length());
            payload.put("truncated", hasFrom && requestedFrom < bufferStart);
            payload.put("hasMore", start + output.length() < session.outputOffset);
            return payload;
        }
    }

    JSONObject restart(JSONObject options) throws Exception {
        Session session = getSession(options.optString("id", ""));
        disposeProcess(session);
        spawn(session, options);
        JSONObject payload = serialize(session, true);
        eventSink.emit("restarted", payload);
        return payload;
    }

    JSONObject close(JSONObject options) throws Exception {
        Session session = getSession(options.optString("id", ""));
        synchronized (sessionsLock) {
            sessions.remove(session.id);
        }
        disposeProcess(session);
        JSONObject event = new JSONObject().put("id", session.id);
        eventSink.emit("closed", event);
        return new JSONObject().put("ok", true).put("id", session.id);
    }

    void disposeAll() {
        List<Session> snapshot;
        synchronized (sessionsLock) {
            snapshot = new ArrayList<>(sessions.values());
            sessions.clear();
        }
        for (Session session : snapshot) disposeProcess(session);
    }

    private void spawn(Session session, JSONObject options) throws Exception {
        int columns = clampDimension(options.optInt("cols", 80), 80, 500);
        int rows = clampDimension(options.optInt("rows", 24), 24, 300);
        int generation;
        synchronized (session) {
            session.generation += 1;
            generation = session.generation;
            session.shell = session.root ? "ROOT Shell" : "Android Shell";
            session.exited = false;
            session.exitCode = null;
            session.buffer = "";
            session.outputOffset = 0;
        }

        String fallbackCwd = activity.getFilesDir().getAbsolutePath();
        String processCwd = session.root ? fallbackCwd : session.cwd;
        if (!new File(processCwd).isDirectory()) processCwd = fallbackCwd;
        String command;
        String[] args;
        if (session.root) {
            command = "su";
            args = new String[]{
                    "su",
                    "-c",
                    "cd " + shellQuote(session.cwd) + " && exec /system/bin/sh -i"
            };
        } else {
            command = "/system/bin/sh";
            args = new String[]{"sh", "-i"};
        }
        String[] environment = new String[]{
                "HOME=" + fallbackCwd,
                "TMPDIR=" + activity.getCacheDir().getAbsolutePath(),
                "PATH=/system/bin:/system/xbin:/vendor/bin:/product/bin",
                "SHELL=/system/bin/sh",
                "TERM=xterm-256color",
                "COLORTERM=truecolor",
                "TERM_PROGRAM=Renge",
                "LANG=en_US.UTF-8"
        };
        RengePtyProcess process = new RengePtyProcess(
                command,
                processCwd,
                args,
                environment,
                columns,
                rows,
                new RengePtyProcess.Listener() {
                    @Override
                    public void onData(String data) {
                        handleData(session, generation, data);
                    }

                    @Override
                    public void onExit(int status) {
                        handleExit(session, generation, status);
                    }
                }
        );
        synchronized (session) {
            if (session.generation != generation) {
                process.close();
                return;
            }
            if (session.exited || !process.isRunning()) {
                process.close();
                return;
            }
            session.process = process;
        }
    }

    private void handleData(Session session, int generation, String data) {
        synchronized (session) {
            if (session.generation != generation) return;
            session.buffer += data;
            session.outputOffset += data.length();
            if (session.buffer.length() > MAX_BUFFER_CHARS) {
                session.buffer = session.buffer.substring(session.buffer.length() - MAX_BUFFER_CHARS);
            }
        }
        try {
            eventSink.emit("data", new JSONObject().put("id", session.id).put("data", data));
        } catch (JSONException ignored) {
        }
    }

    private void handleExit(Session session, int generation, int status) {
        int signal = status < 0 ? -status : 0;
        int exitCode = status < 0 ? 128 + signal : status;
        synchronized (session) {
            if (session.generation != generation) return;
            session.process = null;
            session.exited = true;
            session.exitCode = exitCode;
        }
        try {
            eventSink.emit(
                    "exit",
                    new JSONObject()
                            .put("id", session.id)
                            .put("exitCode", exitCode)
                            .put("signal", signal)
            );
        } catch (JSONException ignored) {
        }
    }

    private void disposeProcess(Session session) {
        RengePtyProcess process;
        synchronized (session) {
            session.generation += 1;
            process = session.process;
            session.process = null;
        }
        if (process != null) process.close();
    }

    private Session getSession(String id) {
        synchronized (sessionsLock) {
            Session session = sessions.get(id);
            if (session == null) throw new IllegalArgumentException("找不到这个终端会话");
            return session;
        }
    }

    private JSONObject serialize(Session session, boolean includeBuffer) throws JSONException {
        synchronized (session) {
            return serializeLocked(session, includeBuffer);
        }
    }

    private JSONObject serializeLocked(Session session, boolean includeBuffer) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("id", session.id);
        payload.put("title", session.title);
        payload.put("shell", session.shell);
        payload.put("cwd", session.cwd);
        payload.put("createdAt", session.createdAt);
        payload.put("exited", session.exited);
        payload.put("exitCode", session.exitCode == null ? JSONObject.NULL : session.exitCode);
        payload.put("outputOffset", session.outputOffset);
        if (includeBuffer) payload.put("buffer", session.buffer);
        return payload;
    }

    private int clampDimension(int value, int fallback, int maximum) {
        return value <= 0 ? fallback : Math.min(maximum, value);
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    private static final class Session {
        final String id;
        final String title;
        final String cwd;
        final boolean root;
        final long createdAt = System.currentTimeMillis();
        String shell = "Android Shell";
        boolean exited;
        Integer exitCode;
        String buffer = "";
        long outputOffset;
        int generation;
        RengePtyProcess process;

        Session(String id, String title, String cwd, boolean root) {
            this.id = id;
            this.title = title;
            this.cwd = cwd;
            this.root = root;
        }
    }
}
