package com.renge.agentlab;

import org.json.JSONArray;
import org.json.JSONException;

/** A real compacted prefix; edits to that prefix invalidate it automatically. */
final class PiContextSnapshot {
    private final JSONArray original;
    private final JSONArray compacted;

    PiContextSnapshot(JSONArray original, JSONArray compacted) throws JSONException {
        if (original == null || compacted == null || original.length() == 0 || compacted.length() == 0
                || compacted.toString().length() >= original.toString().length()) {
            throw new JSONException("上下文尚未实际压缩，请先生成更短的摘要。");
        }
        this.original = new JSONArray(original.toString());
        this.compacted = new JSONArray(compacted.toString());
    }

    JSONArray apply(JSONArray messages) throws JSONException {
        if (messages == null || messages.length() < original.length()) return messages;
        for (int i = 0; i < original.length(); i++) {
            if (!original.get(i).toString().equals(messages.get(i).toString())) return messages;
        }
        JSONArray result = new JSONArray(compacted.toString());
        for (int i = original.length(); i < messages.length(); i++) result.put(messages.get(i));
        return result;
    }

    long estimatedTokens() { return Math.max(1, compacted.toString().length() / 4L); }
}
