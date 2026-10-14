package com.renge.agentlab;

import static org.junit.Assert.assertEquals;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.Test;

public class HtmlPreviewImageTest {
    private String detect(byte[] bytes) throws Exception {
        Method method = LocalWebServer.class.getDeclaredMethod("htmlPreviewImageType", byte[].class);
        method.setAccessible(true);
        return (String) method.invoke(null, (Object) bytes);
    }

    @Test public void detectsImageBytesWithoutTrustingMimeOrExtension() throws Exception {
        assertEquals("image/png", detect(Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=")));
        assertEquals("image/webp", detect("RIFF1234WEBP".getBytes(StandardCharsets.US_ASCII)));
        assertEquals("image/svg+xml", detect("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".getBytes(StandardCharsets.UTF_8)));
        assertEquals("", detect("<html>not an image</html>".getBytes(StandardCharsets.UTF_8)));
        assertEquals("", detect(new byte[3]));
    }
}
