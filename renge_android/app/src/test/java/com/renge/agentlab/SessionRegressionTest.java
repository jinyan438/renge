package com.renge.agentlab;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SessionRegressionTest {
    private JSONObject session(String id, String text) throws Exception {
        return new JSONObject().put("id", id).put("messages", new JSONArray().put(text));
    }

    @Test public void independentSessionUpdatesDoNotOverwriteAndStaleEditsConflict() throws Exception {
        JSONArray initial = new JSONArray().put(session("a", "old-a")).put(session("b", "old-b"));
        JSONObject versions = AppDataSessionPatch.versions(initial);
        JSONObject patchA = new JSONObject().put("upserts", new JSONArray().put(new JSONObject()
                .put("session", session("a", "new-a")).put("expectedVersion", versions.get("a"))))
                .put("deletes", new JSONArray());
        JSONObject patchB = new JSONObject().put("upserts", new JSONArray().put(new JSONObject()
                .put("session", session("b", "new-b")).put("expectedVersion", versions.get("b"))))
                .put("deletes", new JSONArray());
        JSONArray saved = AppDataSessionPatch.apply(AppDataSessionPatch.apply(initial, patchA), patchB);
        assertEquals("new-a", saved.getJSONObject(0).getJSONArray("messages").get(0));
        assertEquals("new-b", saved.getJSONObject(1).getJSONArray("messages").get(0));
        try {
            AppDataSessionPatch.apply(saved, patchA);
            fail("stale writes must conflict");
        } catch (AppDataSessionPatch.ConflictException expected) {
            assertTrue(expected.getMessage().contains("另一窗口"));
        }
    }

    @Test public void compressedContextIsReusedAndEditedHistoryInvalidatesIt() throws Exception {
        JSONObject first = new JSONObject().put("role", "user").put("content", "very long historical details ".repeat(80));
        JSONObject last = new JSONObject().put("role", "user").put("content", "latest request");
        JSONArray original = new JSONArray().put(first).put(last);
        JSONArray compacted = new JSONArray().put(new JSONObject().put("role", "system").put("content", "summary")).put(last);
        PiContextSnapshot snapshot = new PiContextSnapshot(original, compacted);
        JSONArray next = new JSONArray(original.toString()).put(session("next", "new reply"));
        JSONArray applied = snapshot.apply(next);
        assertEquals("summary", applied.getJSONObject(0).getString("content"));
        assertEquals("new reply", applied.getJSONObject(2).getJSONArray("messages").get(0));
        assertTrue(snapshot.estimatedTokens() < original.toString().length() / 4L);
        next.getJSONObject(0).put("content", "edited history");
        assertSame(next, snapshot.apply(next));
    }

    @Test public void unchangedContextCannotBeReportedAsCompressed() throws Exception {
        JSONArray original = new JSONArray().put(session("a", "short"));
        try {
            new PiContextSnapshot(original, original);
            fail("unchanged context must not be a successful compaction");
        } catch (org.json.JSONException expected) {
            assertTrue(expected.getMessage().contains("实际压缩"));
        }
    }
}
