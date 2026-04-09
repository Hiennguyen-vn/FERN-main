package com.natsu.common.utils.log.appender;

import com.natsu.common.utils.log.LogEvent;
import com.natsu.common.utils.log.LogFormatter;
import com.natsu.common.utils.log.LogLevel;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.locks.ReentrantLock;
import java.util.zip.GZIPOutputStream;

/**
 * Appender that writes log events to files with support for:
 * - File rotation by size or date
 * - Compression of rotated files
 * - Configurable file naming patterns
 */
public class FileLogAppender extends AbstractLogAppender {

    private final Path logDirectory;
    private final String fileNamePattern;
    private final long maxFileSize;
    private final int maxHistory;
    private final boolean compressRotated;

    private volatile Path currentFile;
    private volatile BufferedWriter writer;
    private volatile long currentFileSize;
    private volatile LocalDate currentDate;
    private final ReentrantLock writeLock = new ReentrantLock();

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /**
     * Creates a file appender with default settings.
     *
     * @param logDirectory the directory for log files
     */
    public FileLogAppender(Path logDirectory) {
        this("file", logDirectory, "app.log", LogLevel.DEBUG);
    }

    /**
     * Creates a file appender with the specified settings.
     *
     * @param name            the appender name
     * @param logDirectory    the directory for log files
     * @param fileNamePattern the log file name pattern (can include {date})
     * @param level           the minimum log level
     */
    public FileLogAppender(String name, Path logDirectory, String fileNamePattern, LogLevel level) {
        this(name, logDirectory, fileNamePattern, level, 10 * 1024 * 1024, 7, true);
    }

    /**
     * Creates a file appender with full configuration.
     *
     * @param name            the appender name
     * @param logDirectory    the directory for log files
     * @param fileNamePattern the log file name pattern
     * @param level           the minimum log level
     * @param maxFileSize     maximum file size before rotation (bytes)
     * @param maxHistory      maximum number of rotated files to keep
     * @param compressRotated whether to compress rotated files
     */
    public FileLogAppender(String name, Path logDirectory, String fileNamePattern, LogLevel level,
            long maxFileSize, int maxHistory, boolean compressRotated) {
        super(name, level);
        this.logDirectory = logDirectory;
        this.fileNamePattern = fileNamePattern;
        this.maxFileSize = maxFileSize;
        this.maxHistory = maxHistory;
        this.compressRotated = compressRotated;
    }

    @Override
    public void start() {
        writeLock.lock();
        try {
            if (started.get()) {
                return;
            }

            // Create log directory if it doesn't exist
            Files.createDirectories(logDirectory);

            // Initialize current file
            currentDate = LocalDate.now();
            currentFile = resolveCurrentFile();
            openWriter();

            super.start();
        } catch (IOException e) {
            throw new RuntimeException("Failed to start FileLogAppender: " + name, e);
        } finally {
            writeLock.unlock();
        }
    }

    @Override
    protected void doAppend(LogEvent event) {
        if (!isStarted()) {
            return;
        }

        String formatted = LogFormatter.formatForFile(event);

        writeLock.lock();
        try {
            checkRotation();

            writer.write(formatted);
            writer.newLine();
            currentFileSize += formatted.length() + System.lineSeparator().length();
        } catch (IOException e) {
            System.err.println("Failed to write to log file: " + e.getMessage());
        } finally {
            writeLock.unlock();
        }
    }

    @Override
    public void flush() {
        writeLock.lock();
        try {
            if (writer != null) {
                writer.flush();
            }
        } catch (IOException e) {
            System.err.println("Failed to flush log file: " + e.getMessage());
        } finally {
            writeLock.unlock();
        }
    }

    @Override
    public void close() {
        writeLock.lock();
        try {
            if (writer != null) {
                writer.flush();
                writer.close();
                writer = null;
            }
            super.close();
        } catch (IOException e) {
            System.err.println("Failed to close log file: " + e.getMessage());
        } finally {
            writeLock.unlock();
        }
    }

    private Path resolveCurrentFile() {
        String fileName = fileNamePattern;
        if (fileName.contains("{date}")) {
            fileName = fileName.replace("{date}", DATE_FORMATTER.format(currentDate));
        }
        return logDirectory.resolve(fileName);
    }

    private void openWriter() throws IOException {
        currentFile = resolveCurrentFile();
        File file = currentFile.toFile();
        writer = new BufferedWriter(
                new OutputStreamWriter(
                        new FileOutputStream(file, true),
                        StandardCharsets.UTF_8),
                8192);
        // Read file length from the File object directly after opening,
        // ensuring we get the size of the exact file we just opened.
        currentFileSize = file.length();
    }

    private void checkRotation() throws IOException {
        LocalDate today = LocalDate.now();
        boolean needsRotation = false;

        // Check date change
        if (!today.equals(currentDate)) {
            needsRotation = true;
        }

        // Check file size
        if (maxFileSize > 0 && currentFileSize >= maxFileSize) {
            needsRotation = true;
        }

        if (needsRotation) {
            rotate(today);
        }
    }

    private void rotate(LocalDate newDate) throws IOException {
        // Close current writer
        if (writer != null) {
            writer.flush();
            writer.close();
        }

        // Rotate file
        if (Files.exists(currentFile) && Files.size(currentFile) > 0) {
            Path rotatedFile = generateRotatedFileName(currentFile);
            Files.move(currentFile, rotatedFile, StandardCopyOption.REPLACE_EXISTING);

            if (compressRotated) {
                compressFile(rotatedFile);
            }

            // Cleanup old files
            cleanupOldFiles();
        }

        // Update current date and open new file
        currentDate = newDate;
        openWriter();
    }

    private Path generateRotatedFileName(Path file) {
        String name = file.getFileName().toString();
        String timestamp = DATE_FORMATTER.format(currentDate);

        // Find a unique file name
        int index = 1;
        Path rotated;
        do {
            String rotatedName = name + "." + timestamp + "." + index;
            rotated = logDirectory.resolve(rotatedName);
            index++;
        } while (Files.exists(rotated) || Files.exists(Path.of(rotated.toString() + ".gz")));

        return rotated;
    }

    private void compressFile(Path file) {
        Path compressedFile = Path.of(file.toString() + ".gz");
        try (InputStream in = Files.newInputStream(file);
                OutputStream out = new GZIPOutputStream(Files.newOutputStream(compressedFile))) {
            in.transferTo(out);
            Files.delete(file);
        } catch (IOException e) {
            System.err.println("Failed to compress log file: " + e.getMessage());
        }
    }

    private void cleanupOldFiles() {
        if (maxHistory <= 0) {
            return;
        }

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(logDirectory)) {
            java.util.List<Path> logFiles = new java.util.ArrayList<>();
            String baseName = fileNamePattern.replace("{date}", "");

            for (Path entry : stream) {
                String fileName = entry.getFileName().toString();
                if (fileName.startsWith(baseName.replace(".log", "")) &&
                        (fileName.endsWith(".log") || fileName.endsWith(".gz"))) {
                    if (!entry.equals(currentFile)) {
                        logFiles.add(entry);
                    }
                }
            }

            // Sort by modification time (oldest first)
            logFiles.sort((a, b) -> {
                try {
                    return Files.getLastModifiedTime(a).compareTo(Files.getLastModifiedTime(b));
                } catch (IOException e) {
                    return 0;
                }
            });

            // Delete oldest files beyond maxHistory
            while (logFiles.size() > maxHistory) {
                Path oldest = logFiles.remove(0);
                try {
                    Files.delete(oldest);
                } catch (IOException e) {
                    System.err.println("Failed to delete old log file: " + e.getMessage());
                }
            }
        } catch (IOException e) {
            System.err.println("Failed to cleanup old log files: " + e.getMessage());
        }
    }

    /**
     * Gets the current log file path.
     *
     * @return the current log file path
     */
    public Path getCurrentFile() {
        return currentFile;
    }

    /**
     * Builder for FileLogAppender.
     */
    public static class Builder {
        private String name = "file";
        private Path logDirectory = Paths.get("logs");
        private String fileNamePattern = "app-{date}.log";
        private LogLevel level = LogLevel.DEBUG;
        private long maxFileSize = 10 * 1024 * 1024; // 10MB
        private int maxHistory = 7;
        private boolean compressRotated = true;

        public Builder name(String name) {
            this.name = name;
            return this;
        }

        public Builder directory(Path directory) {
            this.logDirectory = directory;
            return this;
        }

        public Builder directory(String directory) {
            this.logDirectory = Paths.get(directory);
            return this;
        }

        public Builder fileNamePattern(String pattern) {
            this.fileNamePattern = pattern;
            return this;
        }

        public Builder level(LogLevel level) {
            this.level = level;
            return this;
        }

        public Builder maxFileSize(long bytes) {
            this.maxFileSize = bytes;
            return this;
        }

        public Builder maxFileSizeMB(int megabytes) {
            this.maxFileSize = megabytes * 1024L * 1024L;
            return this;
        }

        public Builder maxHistory(int days) {
            this.maxHistory = days;
            return this;
        }

        public Builder compressRotated(boolean compress) {
            this.compressRotated = compress;
            return this;
        }

        public FileLogAppender build() {
            FileLogAppender appender = new FileLogAppender(
                    name, logDirectory, fileNamePattern, level,
                    maxFileSize, maxHistory, compressRotated);
            appender.start();
            return appender;
        }
    }

    public static Builder builder() {
        return new Builder();
    }
}
