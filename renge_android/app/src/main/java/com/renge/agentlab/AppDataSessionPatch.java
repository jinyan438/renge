package com.renge.agentlab;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

final class AppDataSessionPatch {
    static final class ConflictException extends IOException {
        ConflictException() {
            super("会话已被另一窗口修改。本页改动尚未保存，请先导出备份，再刷新并合并。");
        }
    }

    static JSONObject versions(JSONArray sessions) throws JSONException {
        JSONObject versions = new JSONObject();
        if (sessions == null) return versions;
        for (int i = 0; i < sessions.length(); i++) {
            JSONObject session = sessions.getJSONObject(i);
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(session.toString().getBytes(StandardCharsets.UTF_8));
                StringBuilder hex = new StringBuilder();
                for (byte value : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                versions.put(session.getString("id"), hex.toString());
            } catch (NoSuchAlgorithmException error) {
                throw new IllegalStateException(error);
            }
        }
        return versions;
    }

    static JSONArray apply(JSONArray sessions, JSONObject patch) throws JSONException, IOException {
        JSONArray upserts = patch.getJSONArray("upserts");
        JSONArray deletes = patch.getJSONArray("deletes");
        JSONObject versions = versions(sessions);
        Set<String> seen = new HashSet<>();
        Map<String, JSONObject> replacements = new LinkedHashMap<>();
        Set<String> removed = new HashSet<>();
        for (int group = 0; group < 2; group++) {
            JSONArray changes = group == 0 ? upserts : deletes;
            for (int i = 0; i < changes.length(); i++) {
                JSONObject change = changes.getJSONObject(i);
                JSONObject session = group == 0 ? change.getJSONObject("session") : null;
                String id = (session == null ? change : session).getString("id");
                if (id.isEmpty() || !seen.add(id) || !change.has("expectedVersion")) {
                    throw new IOException("无效或重复的会话 ID");
                }
                Object expected = change.get("expectedVersion");
                Object actual = versions.has(id) ? versions.get(id) : JSONObject.NULL;
                if (!actual.equals(expected)) throw new ConflictException();
                if (session == null) removed.add(id); else replacements.put(id, session);
            }
        }
        JSONArray result = new JSONArray();
        if (sessions != null) {
            for (int i = 0; i < sessions.length(); i++) {
                JSONObject session = sessions.getJSONObject(i);
                String id = session.getString("id");
                if (removed.contains(id)) continue;
                JSONObject replacement = replacements.remove(id);
                result.put(replacement == null ? session : replacement);
            }
        }
        for (JSONObject session : replacements.values()) result.put(session);
        return result;
    }
}
