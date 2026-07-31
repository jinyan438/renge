package com.termux.terminal;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;

import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/** Raw PTY access built on the native subprocess layer shipped by terminal-emulator. */
public final class RengePtyProcess {
    public interface Listener {
        void onData(String data);

        void onExit(int status);
    }

    private final Object writeLock = new Object();
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final Listener listener;
    private final int processId;
    private final FileOutputStream output;
    private volatile int fileDescriptor;

    public RengePtyProcess(
            String command,
            String cwd,
            String[] args,
            String[] environment,
            int columns,
            int rows,
            Listener listener
    ) {
        this.listener = listener;
        int[] processIds = new int[1];
        fileDescriptor = JNI.createSubprocess(
                command,
                cwd,
                args,
                environment,
                processIds,
                rows,
                columns,
                0,
                0
        );
        processId = processIds[0];
        FileDescriptor wrapped = wrapFileDescriptor(fileDescriptor);
        FileInputStream input = new FileInputStream(wrapped);
        output = new FileOutputStream(wrapped);
        startReader(input);
        startWaiter();
    }

    public void write(String data) throws Exception {
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        synchronized (writeLock) {
            if (closed.get()) throw new IllegalStateException("终端进程已经退出");
            output.write(bytes);
            output.flush();
        }
    }

    public void resize(int columns, int rows) {
        int currentFd = fileDescriptor;
        if (!closed.get() && currentFd >= 0) {
            JNI.setPtyWindowSize(currentFd, rows, columns, 0, 0);
        }
    }

    public boolean isRunning() {
        return !closed.get();
    }

    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        try {
            Os.kill(-processId, OsConstants.SIGKILL);
        } catch (ErrnoException groupError) {
            try {
                Os.kill(processId, OsConstants.SIGKILL);
            } catch (ErrnoException ignored) {
            }
        }
        closeFileDescriptor();
    }

    private void startReader(FileInputStream input) {
        Thread reader = new Thread(() -> {
            try {
                InputStreamReader decoder = new InputStreamReader(input, StandardCharsets.UTF_8);
                char[] buffer = new char[4096];
                while (!closed.get()) {
                    int count = decoder.read(buffer);
                    if (count < 0) break;
                    if (count > 0) listener.onData(new String(buffer, 0, count));
                }
            } catch (Exception ignored) {
                // Closing the PTY interrupts the blocking read.
            }
        }, "RengePtyReader[pid=" + processId + "]");
        reader.setDaemon(true);
        reader.start();
    }

    private void startWaiter() {
        Thread waiter = new Thread(() -> {
            int status = JNI.waitFor(processId);
            closed.set(true);
            closeFileDescriptor();
            listener.onExit(status);
        }, "RengePtyWaiter[pid=" + processId + "]");
        waiter.setDaemon(true);
        waiter.start();
    }

    private synchronized void closeFileDescriptor() {
        if (fileDescriptor < 0) return;
        JNI.close(fileDescriptor);
        fileDescriptor = -1;
    }

    private static FileDescriptor wrapFileDescriptor(int rawFileDescriptor) {
        FileDescriptor result = new FileDescriptor();
        try {
            Field descriptorField;
            try {
                descriptorField = FileDescriptor.class.getDeclaredField("descriptor");
            } catch (NoSuchFieldException error) {
                descriptorField = FileDescriptor.class.getDeclaredField("fd");
            }
            descriptorField.setAccessible(true);
            descriptorField.set(result, rawFileDescriptor);
            return result;
        } catch (ReflectiveOperationException error) {
            JNI.close(rawFileDescriptor);
            throw new IllegalStateException("无法连接 Android PTY", error);
        }
    }
}
