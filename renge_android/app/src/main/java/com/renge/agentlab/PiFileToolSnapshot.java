package com.renge.agentlab;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Android's Pi compatibility layer has no Node runtime. Keep file-tool drafts
 * isolated from live workspace files, using the same read/edit/write contract. */
final class PiFileToolSnapshot {
    private static JSONObject text(String value) throws JSONException {
        return new JSONObject().put("content", new JSONArray().put(new JSONObject().put("type", "text").put("text", value)));
    }

    static JSONObject execute(JSONObject body) throws IOException, JSONException {
        String name = body.getString("name");
        JSONObject args = body.getJSONObject("args");
        String path = args.getString("path").replace('\\', '/');
        if (path.length() > 240 || !path.toLowerCase(java.util.Locale.ROOT).endsWith(".md")) throw new IOException("请使用 Markdown 相对路径。");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.matches(".*[\\x00-\\x1f<>:\"|?*].*")
                    || part.endsWith(".") || part.endsWith(" ") || part.matches("(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?")) {
                throw new IOException("路径不能越出记忆目录。");
            }
        }
        String source = body.isNull("content") ? null : body.getString("content");
        if ("read".equals(name)) {
            if (source == null) throw new IOException("文件不存在。");
            String[] lines = source.split("\n", -1);
            int start = Math.max(1, args.optInt("offset", 1));
            if (start > lines.length) throw new IOException("Offset is beyond end of file");
            int end = Math.min(lines.length, start - 1 + Math.max(1, Math.min(300, args.optInt("limit", 200))));
            StringBuilder content = new StringBuilder();
            for (int i = start - 1; i < end; i++) { if (i > start - 1) content.append('\n'); content.append(lines[i]); }
            if (end < lines.length) content.append("\n\n[").append(lines.length - end).append(" more lines in file. Use offset=").append(end + 1).append(" to continue.]");
            return new JSONObject().put("result", text(content.toString()));
        }
        if ("edit".equals(name)) {
            if (source == null) throw new IOException("文件不存在。");
            boolean bom = source.startsWith("\ufeff"), crlf = source.contains("\r\n");
            String original = (bom ? source.substring(1) : source).replace("\r\n", "\n");
            // Match Pi's prepareArguments: normalize model argument variants
            // before applying the same precise-edit contract.
            Object rawEdits = args.opt("edits");
            if (rawEdits instanceof String) {
                try { rawEdits = new org.json.JSONTokener((String) rawEdits).nextValue(); }
                catch (JSONException ignored) { }
            }
            JSONArray edits = rawEdits instanceof JSONArray ? new JSONArray(rawEdits.toString()) : new JSONArray();
            if (rawEdits instanceof JSONObject) edits.put(rawEdits);
            if (args.opt("oldText") instanceof String && args.opt("newText") instanceof String) {
                edits.put(new JSONObject().put("oldText", args.getString("oldText")).put("newText", args.getString("newText")));
            }
            if (edits.length() == 0) throw new IOException("edits must contain at least one replacement");
            List<int[]> ranges = new ArrayList<>();
            for (int i = 0; i < edits.length(); i++) {
                String old = edits.getJSONObject(i).getString("oldText").replace("\r\n", "\n");
                int at = original.indexOf(old);
                if (old.isEmpty() || at < 0 || original.indexOf(old, at + 1) >= 0) throw new IOException("oldText 必须在原文件中恰好出现一次。");
                ranges.add(new int[]{at, at + old.length(), i});
            }
            ranges.sort(Comparator.comparingInt(range -> range[0]));
            StringBuilder content = new StringBuilder(); int cursor = 0;
            for (int[] range : ranges) {
                if (range[0] < cursor) throw new IOException("edits 不能重叠。");
                content.append(original, cursor, range[0]).append(edits.getJSONObject(range[2]).getString("newText").replace("\r\n", "\n"));
                cursor = range[1];
            }
            content.append(original.substring(cursor));
            String updated = (bom ? "\ufeff" : "") + (crlf ? content.toString().replace("\n", "\r\n") : content.toString());
            return new JSONObject().put("content", updated).put("result", text("Successfully replaced " + edits.length() + " block(s) in " + path + "."));
        }
        if (!"write".equals(name)) throw new IOException("不支持的文件工具。");
        String operation = args.getString("operation"), chunk = args.getString("content");
        double expected = args.getDouble("expected_bytes");
        if (expected < 0 || expected != Math.floor(expected) || !Double.isFinite(expected) || chunk.isEmpty()) throw new IOException("写入内容或字节偏移无效。");
        boolean applied = false; String updated;
        if ("overwrite".equals(operation)) {
            if (expected != 0) throw new IOException("overwrite 的 expected_bytes 必须为 0。");
            if (body.optBoolean("initialized") && !chunk.equals(source)) throw new IOException("本轮已经初始化过该文件，请使用 append 或 edit 继续。");
            applied = chunk.equals(source); updated = chunk;
        } else if ("append".equals(operation)) {
            if (source == null) throw new IOException("append 目标不存在。");
            int size = source.getBytes(StandardCharsets.UTF_8).length;
            applied = size == expected + chunk.getBytes(StandardCharsets.UTF_8).length && source.endsWith(chunk);
            if (!applied && size != expected) throw new IOException("append 偏移不匹配，请先 read 检查。");
            updated = applied ? source : source + chunk;
        } else throw new IOException("write.operation 必须是 overwrite 或 append。");
        int size = updated.getBytes(StandardCharsets.UTF_8).length;
        JSONObject details = new JSONObject().put("status", applied ? "already_applied" : "written").put("operation", operation)
                .put("path", path).put("bytesWritten", chunk.getBytes(StandardCharsets.UTF_8).length).put("totalBytes", size).put("nextExpectedBytes", size);
        return new JSONObject().put("content", updated).put("result", text("next expected_bytes: " + size).put("details", details));
    }
}
