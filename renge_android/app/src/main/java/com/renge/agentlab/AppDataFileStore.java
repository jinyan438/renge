package com.renge.agentlab;

import android.util.AtomicFile;
import android.util.JsonReader;
import android.util.JsonToken;
import android.util.JsonWriter;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.StringWriter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

// Keep the unchanged parts of a large restored database on disk. Even a tiny
// settings patch must not parse and stringify every card, image and session.
final class AppDataFileStore {
    private interface WriteOperation {
        void write(JsonWriter writer) throws IOException, JSONException;
    }

    static void write(File target, JSONObject data) throws IOException, JSONException {
        writeAtomically(target, writer -> writeValue(writer, data));
    }

    static JSONArray characterChats(File source, String avatar) throws IOException, JSONException {
        String cardId = "";
        JSONArray chats = new JSONArray();
        try (JsonReader reader = new JsonReader(new InputStreamReader(
                new BufferedInputStream(new AtomicFile(source).openRead()), StandardCharsets.UTF_8))) {
            reader.beginObject();
            while (reader.hasNext()) {
                String key = reader.nextName();
                if (("characterCards".equals(key) || "chatSessions".equals(key)) && reader.peek() == JsonToken.BEGIN_ARRAY) {
                    reader.beginArray();
                    while (reader.hasNext()) {
                        if (reader.peek() != JsonToken.BEGIN_OBJECT) { reader.skipValue(); continue; }
                        JSONObject fields = new JSONObject();
                        reader.beginObject();
                        while (reader.hasNext()) {
                            String name = reader.nextName();
                            if (("id".equals(name) || "avatarDataUrl".equals(name) || "roleplayCharacterCardId".equals(name))
                                    && reader.peek() == JsonToken.STRING) fields.put(name, reader.nextString());
                            else reader.skipValue();
                        }
                        reader.endObject();
                        if ("chatSessions".equals(key)) chats.put(fields);
                        else if (cardId.isEmpty() && (avatar.equals(fields.optString("avatarDataUrl"))
                                || avatar.equals(fields.optString("id") + ".png"))) cardId = fields.optString("id");
                    }
                    reader.endArray();
                } else reader.skipValue();
            }
            reader.endObject();
        }
        JSONArray result = new JSONArray();
        for (int index = 0; !cardId.isEmpty() && index < chats.length(); index++) {
            JSONObject chat = chats.getJSONObject(index);
            if (cardId.equals(chat.optString("roleplayCharacterCardId"))) {
                result.put(new JSONObject().put("file_name", chat.optString("id") + ".jsonl"));
            }
        }
        return result;
    }

    static JSONObject patch(File source, File target, JSONObject patch, JSONObject sessionPatch,
                            JSONObject versions) throws IOException, JSONException {
        if (patch.has("chatSessions")) throw new AppDataSessionPatch.ConflictException();
        AppDataSessionPatch.Plan plan = sessionPatch == null ? null : AppDataSessionPatch.prepare(versions, sessionPatch);
        boolean sessionsChanged = plan != null && (!plan.removed.isEmpty() || !plan.replacements.isEmpty());
        if (plan != null) {
            for (String id : plan.removed) versions.remove(id);
            for (JSONObject session : plan.replacements.values()) {
                String id = session.getString("id");
                versions.put(id, AppDataSessionPatch.versions(new JSONArray().put(session)).get(id));
            }
        }
        Set<String> pending = new LinkedHashSet<>();
        for (Iterator<String> keys = patch.keys(); keys.hasNext();) pending.add(keys.next());
        // Older Android AtomicFile implementations rename the original when
        // startWrite() runs. Open it first, then close it before committing.
        try (JsonReader sourceReader = source.isFile() && source.length() > 0
                ? new JsonReader(new InputStreamReader(new BufferedInputStream(new FileInputStream(source)), StandardCharsets.UTF_8))
                : null) {
            writeAtomically(target, writer -> {
                writer.beginObject();
                boolean sessionsWritten = false;
                if (sourceReader != null) {
                    try (JsonReader reader = sourceReader) {
                        reader.beginObject();
                        while (reader.hasNext()) {
                            String key = reader.nextName();
                            writer.name(key);
                            if (pending.remove(key)) {
                                reader.skipValue();
                                writeValue(writer, patch.get(key));
                            } else if ("chatSessions".equals(key) && plan != null) {
                                if (!sessionsChanged && reader.peek() == JsonToken.BEGIN_ARRAY) copyValue(reader, writer);
                                else copySessions(reader, writer, plan);
                                sessionsWritten = true;
                            } else {
                                copyValue(reader, writer);
                            }
                        }
                        reader.endObject();
                        if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("应用主数据包含多余内容。");
                    }
                }
                for (String key : pending) {
                    writer.name(key);
                    writeValue(writer, patch.get(key));
                }
                if (plan != null && !sessionsWritten) {
                    writer.name("chatSessions").beginArray();
                    for (JSONObject session : plan.replacements.values()) writeValue(writer, session);
                    writer.endArray();
                }
                writer.endObject();
            });
        }
        return versions;
    }

    private static void copySessions(JsonReader reader, JsonWriter writer, AppDataSessionPatch.Plan plan)
            throws IOException, JSONException {
        writer.beginArray();
        if (reader.peek() == JsonToken.BEGIN_ARRAY) {
            reader.beginArray();
            while (reader.hasNext()) {
                // One session at a time; never retain the complete session list.
                StringWriter buffer = new StringWriter();
                try (JsonWriter sessionWriter = new JsonWriter(buffer)) { copyValue(reader, sessionWriter); }
                JSONObject session = new JSONObject(buffer.toString());
                String id = session.getString("id");
                if (plan.removed.contains(id)) continue;
                JSONObject replacement = plan.replacements.remove(id);
                writeValue(writer, replacement == null ? session : replacement);
            }
            reader.endArray();
        } else {
            reader.skipValue();
        }
        for (JSONObject session : plan.replacements.values()) writeValue(writer, session);
        writer.endArray();
    }

    private static void writeAtomically(File target, WriteOperation operation) throws IOException, JSONException {
        File parent = target.getParentFile();
        if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IOException("无法创建应用数据目录。");
        AtomicFile file = new AtomicFile(target);
        FileOutputStream output = file.startWrite();
        boolean saved = false;
        try {
            JsonWriter writer = new JsonWriter(new BufferedWriter(
                    new OutputStreamWriter(output, StandardCharsets.UTF_8), 64 * 1024));
            operation.write(writer);
            writer.flush();
            output.getFD().sync();
            file.finishWrite(output);
            saved = true;
        } finally {
            if (!saved) file.failWrite(output);
        }
    }

    private static void writeValue(JsonWriter writer, Object value) throws IOException, JSONException {
        if (value == null || value == JSONObject.NULL) writer.nullValue();
        else if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            writer.beginObject();
            for (Iterator<String> keys = object.keys(); keys.hasNext();) {
                String key = keys.next();
                writer.name(key);
                writeValue(writer, object.get(key));
            }
            writer.endObject();
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            writer.beginArray();
            for (int index = 0; index < array.length(); index++) writeValue(writer, array.get(index));
            writer.endArray();
        } else if (value instanceof Number) writer.value((Number) value);
        else if (value instanceof Boolean) writer.value((Boolean) value);
        else writer.value(String.valueOf(value));
    }

    private static void copyValue(JsonReader reader, JsonWriter writer) throws IOException {
        switch (reader.peek()) {
            case BEGIN_OBJECT:
                reader.beginObject();
                writer.beginObject();
                while (reader.hasNext()) {
                    writer.name(reader.nextName());
                    copyValue(reader, writer);
                }
                reader.endObject();
                writer.endObject();
                break;
            case BEGIN_ARRAY:
                reader.beginArray();
                writer.beginArray();
                while (reader.hasNext()) copyValue(reader, writer);
                reader.endArray();
                writer.endArray();
                break;
            case STRING: writer.value(reader.nextString()); break;
            case NUMBER: writer.value(new BigDecimal(reader.nextString())); break;
            case BOOLEAN: writer.value(reader.nextBoolean()); break;
            case NULL: reader.nextNull(); writer.nullValue(); break;
            default: throw new IOException("应用主数据包含无效的 JSON 值。");
        }
    }
}
