package com.renge.agentlab;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Arrays;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public class CompleteBackupZipTest {
    // Produced by the browser streaming exporter: STORED entry with a data
    // descriptor, and ZIP signatures inside the binary payload itself.
    private static final String STREAMED_ZIP = "UEsDBBQACAAAAFmlTl0AAAAAAAAAAAAAAAARAAAAYXNzZXRzL2F2YXRhci5wbmdQSwcIUEsDBAD/UEsHCIq9YCQKAAAACgAAAFBLAQIUABQACAAAAFmlTl2KvWAkCgAAAAoAAAARAAAAAAAAAAAAAAAAAAAAAABhc3NldHMvYXZhdGFyLnBuZ1BLBQYAAAAAAQABAD8AAABJAAAAAAA=";

    private long limit() throws Exception {
        Field field = LocalWebServer.class.getDeclaredField("MAX_COMPLETE_BACKUP_EXTRACTED_BYTES");
        field.setAccessible(true);
        return field.getLong(null);
    }

    private InputStream wrap(InputStream input, long maxBytes, ZipEntry entry) throws Exception {
        Class<?> type = Class.forName("com.renge.agentlab.LocalWebServer$CompleteBackupEntryInputStream");
        Constructor<?> constructor = type.getDeclaredConstructor(InputStream.class, long.class, ZipEntry.class);
        constructor.setAccessible(true);
        return (InputStream) constructor.newInstance(input, maxBytes, entry);
    }

    @Test public void readsStoredStreamingEntriesWithoutConfusingEmbeddedSignatures() throws Exception {
        Path fixture = Files.createTempFile("renge-streamed-zip-", ".zip");
        try {
            Files.write(fixture, Base64.getDecoder().decode(STREAMED_ZIP));
            try (ZipFile zip = new ZipFile(fixture.toFile())) {
                ZipEntry entry = zip.getEntry("assets/avatar.png");
                try (InputStream input = wrap(zip.getInputStream(entry), limit(), entry)) {
                    assertArrayEquals(new byte[]{80, 75, 7, 8, 80, 75, 3, 4, 0, (byte) 255}, input.readAllBytes());
                }
            }
        } finally { Files.deleteIfExists(fixture); }
    }

    @Test public void detectsCorruptedPayloadAndActualOutputExceedingBudget() throws Exception {
        ZipEntry entry = new ZipEntry("assets/avatar.png");
        entry.setSize(3);
        CRC32 checksum = new CRC32();
        checksum.update(new byte[]{1, 2, 3});
        entry.setCrc(checksum.getValue());
        try (InputStream input = wrap(new ByteArrayInputStream(new byte[]{1, 2, 4}), limit(), entry)) {
            assertThrows(IOException.class, input::readAllBytes);
        }
        try (InputStream input = wrap(new ByteArrayInputStream(new byte[]{1, 2, 3}), 2, entry)) {
            assertThrows(IOException.class, input::readAllBytes);
        }
    }

    @Test public void streamsMoreThan512MiBUsingOneSmallBuffer() throws Exception {
        final long size = 520L * 1024L * 1024L;
        byte[] buffer = new byte[64 * 1024];
        CRC32 checksum = new CRC32();
        for (long remaining = size; remaining > 0; remaining -= buffer.length) {
            checksum.update(buffer, 0, (int) Math.min(buffer.length, remaining));
        }
        ZipEntry entry = new ZipEntry("files/skills/large.txt");
        entry.setSize(size);
        entry.setCrc(checksum.getValue());
        InputStream generated = new InputStream() {
            long remaining = size;
            @Override public int read() { if (remaining == 0) return -1; remaining--; return 0; }
            @Override public int read(byte[] bytes, int offset, int length) {
                if (remaining == 0) return -1;
                int count = (int) Math.min(length, remaining);
                Arrays.fill(bytes, offset, offset + count, (byte) 0);
                remaining -= count;
                return count;
            }
        };
        long read = 0;
        try (InputStream input = wrap(generated, limit(), entry)) {
            int count;
            while ((count = input.read(buffer)) != -1) read += count;
        }
        assertEquals(size, read);
    }
}
