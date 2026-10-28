package com.renge.agentlab;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public class PiFileToolSnapshotTest {
    private JSONObject call(String name, String content, JSONObject args, boolean initialized) throws Exception {
        return PiFileToolSnapshot.execute(new JSONObject().put("name", name).put("content", content == null ? JSONObject.NULL : content)
                .put("args", args).put("initialized", initialized));
    }
    private JSONObject write(String content, String operation, int expected) throws Exception {
        return new JSONObject().put("path", "人物/约定.md").put("content", content).put("operation", operation).put("expected_bytes", expected);
    }
    private JSONObject edit(String oldText, String newText) throws Exception {
        return new JSONObject().put("oldText", oldText).put("newText", newText);
    }

    @Test public void chunkedWritesUseUtf8OffsetsAndRetryIsIdempotent() throws Exception {
        JSONObject first = call("write", null, write("铜门", "overwrite", 0), false);
        assertEquals(6, first.getJSONObject("result").getJSONObject("details").getInt("nextExpectedBytes"));
        JSONObject append = write("：黎明开启", "append", 6);
        String updated = call("write", "铜门", append, true).getString("content");
        assertEquals("铜门：黎明开启", updated);
        JSONObject retry = call("write", updated, append, true);
        assertEquals(updated, retry.getString("content"));
        assertEquals("already_applied", retry.getJSONObject("result").getJSONObject("details").getString("status"));
        try { call("write", updated, write("覆盖", "overwrite", 0), true); fail(); } catch (IOException expected) { }
        try { call("write", updated, write("追加", "append", 2), true); fail(); } catch (IOException expected) { }
    }

    @Test public void editsUseOriginalCoordinatesAndPreserveBomAndCrlf() throws Exception {
        String source = "\ufeff金币：10\r\n位置：港口\r\n装备：银剑";
        JSONObject args = new JSONObject().put("path", "人物.md").put("edits", new JSONArray()
                .put(edit("金币：10", "金币：9")).put(edit("位置：港口", "位置：钟楼")));
        assertEquals("\ufeff金币：9\r\n位置：钟楼\r\n装备：银剑", call("edit", source, args, false).getString("content"));
        args.put("edits", new JSONArray().put(edit("金币：10", "金币：9")).put(edit("金币：1", "重复")));
        try { call("edit", source, args, false); fail(); } catch (IOException expected) { }
    }

    @Test public void readsAreScopedToTheProvidedSnapshot() throws Exception {
        JSONObject args = new JSONObject().put("path", "人物.md").put("offset", 2).put("limit", 1);
        String text = call("read", "第一行\n第二行\n第三行", args, false).getJSONObject("result").getJSONArray("content").getJSONObject(0).getString("text");
        assertTrue(text.startsWith("第二行")); assertTrue(text.contains("offset=3")); assertFalse(text.contains("第一行"));
        for (String path : new String[]{"../外部.md", "/绝对.md", "C:/绝对.md", "a//b.md", "CON.md"}) {
            try { call("read", "秘密", new JSONObject().put("path", path), false); fail(path); } catch (IOException expected) { }
        }
        try { call("powershell", "内容", new JSONObject().put("path", "人物.md"), false); fail(); } catch (IOException expected) { }
    }
}
