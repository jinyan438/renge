package com.renge.agentlab;

import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

final class CompleteBackupImportResponse {
    private final byte[] prefix;
    private final File localStorage;
    private final byte[] suffix = "}".getBytes(StandardCharsets.UTF_8);

    CompleteBackupImportResponse(String exportedAt, long bytes, File localStorage, JSONObject counts) throws IOException {
        if (!localStorage.isFile()) throw new IOException("恢复后的本地设置文件不存在。");
        this.localStorage = localStorage;
        this.prefix = ("{\"ok\":true,\"exportedAt\":" + JSONObject.quote(exportedAt)
                + ",\"bytes\":" + bytes + ",\"restoredCounts\":" + counts.toString()
                + ",\"localStorage\":").getBytes(StandardCharsets.UTF_8);
    }

    long length() { return prefix.length + localStorage.length() + suffix.length; }

    void writeTo(OutputStream output) throws IOException {
        output.write(prefix);
        try (FileInputStream input = new FileInputStream(localStorage)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        output.write(suffix);
    }
}
