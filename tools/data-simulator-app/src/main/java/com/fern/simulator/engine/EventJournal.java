package com.fern.simulator.engine;

import com.fern.simulator.model.SimEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Map;

/**
 * Streams simulation events to a JSONL file on disk.
 * <p>
 * The first line is a header containing the seed and config hash for reproducibility.
 * Each subsequent line is a serialized {@link SimEvent}.
 */
public final class EventJournal implements Closeable {

    private static final Logger log = LoggerFactory.getLogger(EventJournal.class);
    private static final ObjectMapper JSON = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private final Path filePath;
    private final BufferedWriter writer;

    public EventJournal(Path outputDir, String namespace, long seed, String configHash) throws IOException {
        Files.createDirectories(outputDir);
        this.filePath = outputDir.resolve(namespace + "-journal.jsonl");

        this.writer = Files.newBufferedWriter(filePath,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);

        // Write header line
        String header = JSON.writeValueAsString(Map.of(
                "type", "header",
                "seed", seed,
                "namespace", namespace,
                "configHash", configHash
        ));
        writer.write(header);
        writer.newLine();
        writer.flush();

        log.info("Event journal initialized: {}", filePath);
    }

    /** Append an event to the journal file. */
    public void record(SimEvent event) {
        try {
            writer.write(JSON.writeValueAsString(event));
            writer.newLine();
        } catch (IOException e) {
            log.warn("Failed to write event to journal", e);
        }
    }

    /** Flush pending writes. Call periodically (e.g., every 30 days). */
    public void flush() {
        try {
            writer.flush();
        } catch (IOException e) {
            log.warn("Failed to flush journal", e);
        }
    }

    public Path getFilePath() {
        return filePath;
    }

    @Override
    public void close() throws IOException {
        writer.flush();
        writer.close();
        log.info("Event journal closed: {}", filePath);
    }
}
