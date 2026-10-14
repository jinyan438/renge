package com.renge.agentlab;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

public class CompleteBackupImportResponseTest {
    @Test public void responsePreservesSettingsAndReportsRestoredCounts() throws Exception {
        Path file = Files.createTempFile("renge-restore-settings-", ".json");
        try {
            JSONObject settings = new JSONObject().put("renge_fixture", "中文😀\n\"内容\"");
            Files.write(file, settings.toString().getBytes(StandardCharsets.UTF_8));
            CompleteBackupImportResponse response = new CompleteBackupImportResponse("2026-10-14T00:00:00Z", 123,
                    file.toFile(), new JSONObject().put("characterCards", 50).put("chatSessions", 47));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            response.writeTo(bytes);
            assertEquals(response.length(), bytes.size());
            JSONObject restored = new JSONObject(bytes.toString(StandardCharsets.UTF_8));
            assertTrue(restored.getBoolean("ok"));
            assertEquals(settings.toString(), restored.getJSONObject("localStorage").toString());
            assertEquals(50, restored.getJSONObject("restoredCounts").getInt("characterCards"));
            assertEquals(47, restored.getJSONObject("restoredCounts").getInt("chatSessions"));
        } finally { Files.deleteIfExists(file); }
    }

    @Test public void largeSettingsAreWrittenInSmallChunksWithoutBuildingOneBigJsonString() throws Exception {
        Path file = Files.createTempFile("renge-restore-large-settings-", ".json");
        try {
            byte[] chunk = new byte[64 * 1024];
            Arrays.fill(chunk, (byte) 'x');
            try (OutputStream output = Files.newOutputStream(file)) {
                output.write("{\"renge_fixture\":\"".getBytes(StandardCharsets.UTF_8));
                for (int i = 0; i < 1024; i++) output.write(chunk);
                output.write("\"}".getBytes(StandardCharsets.UTF_8));
            }
            CompleteBackupImportResponse response = new CompleteBackupImportResponse("today", 123,
                    file.toFile(), new JSONObject());
            final long[] written = {0};
            final int[] largest = {0};
            response.writeTo(new OutputStream() {
                @Override public void write(int value) { written[0]++; }
                @Override public void write(byte[] data, int offset, int length) {
                    written[0] += length;
                    largest[0] = Math.max(largest[0], length);
                }
            });
            assertEquals(response.length(), written[0]);
            assertTrue(largest[0] <= 64 * 1024);
        } finally { Files.deleteIfExists(file); }
    }
}
