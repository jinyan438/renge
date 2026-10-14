package com.renge.agentlab;

import android.test.AndroidTestCase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public class AppDataFileStoreTest extends AndroidTestCase {
    private File temporaryFile() throws IOException {
        return File.createTempFile("renge-streaming-store-", ".json", getContext().getCacheDir());
    }

    private String readSmall(File file) throws IOException {
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int count = 0;
            while (count < bytes.length) {
                int length = input.read(bytes, count, bytes.length - count);
                if (length < 0) throw new IOException("Unexpected end of fixture");
                count += length;
            }
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    public void testSettingsPatchPreservesNestedDataAndCanPatchTheSameFile() throws Exception {
        File file = temporaryFile();
        try {
            JSONObject original = new JSONObject("{\"version\":1,\"unknown\":{\"text\":\"中文😀\\n\\\"\",\"values\":[null,true,1.25]},\"characterCards\":[{\"id\":\"card\"}],\"chatSessions\":[]}");
            AppDataFileStore.write(file, original);
            AppDataFileStore.patch(file, file, new JSONObject().put("theme", "dark"), null, new JSONObject());
            JSONObject restored = new JSONObject(readSmall(file));
            assertEquals("dark", restored.getString("theme"));
            restored.remove("theme");
            assertEquals(original.toString(), restored.toString());
        } finally { file.delete(); }
    }

    public void testSessionChangesPreserveIndependentEditsAndRejectConflicts() throws Exception {
        File file = temporaryFile();
        try {
            JSONArray sessions = new JSONArray("[{\"id\":\"a\",\"text\":\"old-a\"},{\"id\":\"b\",\"text\":\"old-b\"}]");
            AppDataFileStore.write(file, new JSONObject().put("characterCards", new JSONArray().put("preserved")).put("chatSessions", sessions));
            JSONObject versions = AppDataSessionPatch.versions(sessions);
            JSONObject patch = new JSONObject().put("upserts", new JSONArray().put(new JSONObject()
                    .put("session", new JSONObject().put("id", "a").put("text", "new-a")).put("expectedVersion", versions.get("a"))))
                    .put("deletes", new JSONArray());
            JSONObject updated = AppDataFileStore.patch(file, file, new JSONObject(), patch, versions);
            JSONObject restored = new JSONObject(readSmall(file));
            assertEquals("new-a", restored.getJSONArray("chatSessions").getJSONObject(0).getString("text"));
            assertEquals("old-b", restored.getJSONArray("chatSessions").getJSONObject(1).getString("text"));
            assertEquals("preserved", restored.getJSONArray("characterCards").getString(0));
            assertEquals(AppDataSessionPatch.versions(restored.getJSONArray("chatSessions")).toString(), updated.toString());
            String beforeConflict = readSmall(file);
            try {
                AppDataFileStore.patch(file, file, new JSONObject(), patch, updated);
                fail("Stale writes must conflict");
            } catch (AppDataSessionPatch.ConflictException expected) { }
            assertEquals(beforeConflict, readSmall(file));

            JSONObject addAndDelete = new JSONObject().put("upserts", new JSONArray().put(new JSONObject()
                    .put("session", new JSONObject().put("id", "c").put("text", "new-c")).put("expectedVersion", JSONObject.NULL)))
                    .put("deletes", new JSONArray().put(new JSONObject().put("id", "b").put("expectedVersion", updated.get("b"))));
            AppDataFileStore.patch(file, file, new JSONObject(), addAndDelete, updated);
            JSONArray remaining = new JSONObject(readSmall(file)).getJSONArray("chatSessions");
            assertEquals(2, remaining.length());
            assertEquals("a", remaining.getJSONObject(0).getString("id"));
            assertEquals("c", remaining.getJSONObject(1).getString("id"));
        } finally { file.delete(); }
    }

    public void testMalformedSourceRollsBackWithoutReplacingTheOriginal() throws Exception {
        File file = temporaryFile();
        try {
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write("{\"keep\":[1,2".getBytes(StandardCharsets.UTF_8));
            }
            String before = readSmall(file);
            try {
                AppDataFileStore.patch(file, file, new JSONObject().put("theme", "dark"), null, new JSONObject());
                fail("Invalid data must not be overwritten");
            } catch (IOException expected) { }
            assertEquals(before, readSmall(file));
        } finally { file.delete(); }
    }

    public void testCharacterChatLookupSkipsBodiesAndSupportsEitherRootFieldOrder() throws Exception {
        File file = temporaryFile();
        try {
            String chats = "\"chatSessions\":[{\"id\":\"s\",\"roleplayCharacterCardId\":\"card\",\"messages\":[\"preserved\"]},{\"id\":\"other\"}]";
            String cards = "\"characterCards\":[{\"id\":\"card\",\"avatarDataUrl\":\"/avatar.png\"}]";
            for (String fixture : new String[]{"{" + chats + "," + cards + "}", "{" + cards + "," + chats + "}"}) {
                try (FileOutputStream output = new FileOutputStream(file)) { output.write(fixture.getBytes(StandardCharsets.UTF_8)); }
                assertEquals("s.jsonl", AppDataFileStore.characterChats(file, "card.png").getJSONObject(0).getString("file_name"));
                assertEquals("s.jsonl", AppDataFileStore.characterChats(file, "/avatar.png").getJSONObject(0).getString("file_name"));
                assertEquals(0, AppDataFileStore.characterChats(file, "missing.png").length());
            }
        } finally { file.delete(); }
    }

    public void test64MiBDatabaseSettingsPatchUsesBoundedMemoryAndPreservesEveryCard() throws Exception {
        File file = temporaryFile();
        File previous = temporaryFile();
        try {
            char[] chunk = new char[4096];
            Arrays.fill(chunk, 'x');
            try (OutputStreamWriter output = new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8)) {
                output.write("{\"characterCards\":[");
                for (int card = 0; card < 64; card++) {
                    if (card != 0) output.write(',');
                    output.write("{\"id\":\"card-" + card + "\",\"description\":\"");
                    for (int i = 0; i < 256; i++) output.write(chunk);
                    output.write("\"}");
                }
                output.write("],\"chatSessions\":[]}");
            }
            try (FileInputStream input = new FileInputStream(file); FileOutputStream output = new FileOutputStream(previous)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            AppDataFileStore.patch(file, file, new JSONObject().put("fixtureUpdated", 1), null, new JSONObject());
            try (FileInputStream before = new FileInputStream(previous); FileInputStream after = new FileInputStream(file)) {
                byte[] left = new byte[64 * 1024], right = new byte[64 * 1024];
                for (long remaining = previous.length() - 1; remaining > 0;) {
                    int count = before.read(left, 0, (int) Math.min(left.length, remaining));
                    assertTrue(count > 0);
                    int read = 0;
                    while (read < count) {
                        int next = after.read(right, read, count - read);
                        assertTrue(next > 0);
                        read += next;
                    }
                    assertTrue(Arrays.equals(Arrays.copyOf(left, count), Arrays.copyOf(right, count)));
                    remaining -= count;
                }
                byte[] suffix = ",\"fixtureUpdated\":1}".getBytes(StandardCharsets.UTF_8);
                for (byte expected : suffix) assertEquals(expected & 255, after.read());
                assertEquals(-1, after.read());
            }
        } finally { file.delete(); previous.delete(); }
    }
}
