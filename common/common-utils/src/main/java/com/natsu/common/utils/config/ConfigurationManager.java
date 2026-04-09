package com.natsu.common.utils.config;

import com.natsu.common.utils.config.parser.ConfigParser;
import com.natsu.common.utils.config.parser.ConfigParserFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Configuration manager that handles loading, caching, and watching
 * configuration files.
 * Supports YAML, JSON, and TOML formats with automatic file change detection.
 *
 * <p>
 * Example usage:
 * 
 * <pre>
 * ConfigurationManager manager = ConfigurationManager.builder()
 *         .withBaseDirectory(Paths.get("/app/config"))
 *         .withAutoReload(true)
 *         .withSaveDelay(Duration.ofSeconds(1))
 *         .build();
 *
 * ConfigSection config = manager.getConfig("application.yml");
 * String dbHost = config.getString("database.host", "localhost");
 * </pre>
 */
public class ConfigurationManager implements Closeable {

    private static final Logger log = LoggerFactory.getLogger(ConfigurationManager.class);

    private final Path baseDirectory;
    private final boolean autoReload;
    private final java.time.Duration saveDelay;
    private final java.time.Duration reloadDebounce;

    private final Map<String, ConfigSection> configurationCache = new ConcurrentHashMap<>();
    private final Map<String, Long> pendingSaves = new ConcurrentHashMap<>();
    private final Map<Path, WatchService> watchServices = new ConcurrentHashMap<>();
    private final Set<String> watchedFiles = ConcurrentHashMap.newKeySet();
    private final List<ConfigurationChangeListener> changeListeners = new CopyOnWriteArrayList<>();

    private final ScheduledExecutorService scheduler;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private ScheduledFuture<?> saveTask;
    private ScheduledFuture<?> watchTask;

    /**
     * Creates a new ConfigurationManager with the specified settings.
     */
    private ConfigurationManager(Builder builder) {
        this.baseDirectory = builder.baseDirectory;
        this.autoReload = builder.autoReload;
        this.saveDelay = builder.saveDelay;
        this.reloadDebounce = builder.reloadDebounce;
        this.scheduler = Executors.newScheduledThreadPool(2, r -> {
            Thread t = new Thread(r, "config-manager");
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Starts the configuration manager, enabling auto-save and file watching.
     *
     * @return this manager for chaining
     */
    public ConfigurationManager start() {
        if (running.compareAndSet(false, true)) {
            log.info("Starting ConfigurationManager with base directory: {}", baseDirectory);

            // Start periodic save task
            if (saveDelay != null && !saveDelay.isZero()) {
                saveTask = scheduler.scheduleWithFixedDelay(
                        this::flushPendingSaves,
                        saveDelay.toMillis(),
                        saveDelay.toMillis(),
                        TimeUnit.MILLISECONDS);
            }

            // Start file watcher task
            if (autoReload) {
                long debounceMs = reloadDebounce != null ? reloadDebounce.toMillis() : 500;
                watchTask = scheduler.scheduleWithFixedDelay(
                        this::pollWatchers,
                        debounceMs,
                        debounceMs,
                        TimeUnit.MILLISECONDS);
            }
        }
        return this;
    }

    /**
     * Stops the configuration manager, flushing pending saves and closing watchers.
     */
    public void stop() {
        if (running.compareAndSet(true, false)) {
            log.info("Stopping ConfigurationManager");

            if (saveTask != null) {
                saveTask.cancel(false);
            }
            if (watchTask != null) {
                watchTask.cancel(false);
            }

            flushPendingSaves();
            closeWatchers();

            configurationCache.clear();
            pendingSaves.clear();
            watchedFiles.clear();
        }
    }

    @Override
    public void close() {
        stop();
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Gets a configuration by name, loading it if not cached.
     *
     * @param name the configuration name (e.g., "application.yml",
     *             "config/database.json")
     * @return the ConfigSection for the configuration
     */
    public ConfigSection getConfig(String name) {
        Path fullPath = resolvePath(name);
        String cacheKey = fullPath.toString();

        return configurationCache.computeIfAbsent(cacheKey, k -> {
            ConfigSection config = loadConfig(fullPath);
            if (autoReload && running.get()) {
                registerWatcher(fullPath);
            }
            log.debug("Loaded configuration: {}", name);
            return config;
        });
    }

    /**
     * Gets a configuration, returning a default if not found.
     *
     * @param name          the configuration name
     * @param defaultConfig the default configuration
     * @return the ConfigSection or default
     */
    public ConfigSection getConfig(String name, ConfigSection defaultConfig) {
        try {
            Path fullPath = resolvePath(name);
            if (Files.exists(fullPath)) {
                return getConfig(name);
            }
        } catch (Exception e) {
            log.debug("Configuration not found: {}, using default", name);
        }
        return defaultConfig;
    }

    /**
     * Loads a configuration from a classpath resource.
     *
     * @param resourcePath the classpath resource path
     * @return the ConfigSection for the resource
     */
    public ConfigSection loadFromResource(String resourcePath) {
        return loadFromResource(resourcePath, getClass().getClassLoader());
    }

    /**
     * Loads a configuration from a classpath resource using a specific class
     * loader.
     *
     * @param resourcePath the classpath resource path
     * @param classLoader  the class loader to use
     * @return the ConfigSection for the resource
     */
    public ConfigSection loadFromResource(String resourcePath, ClassLoader classLoader) {
        try (InputStream is = classLoader.getResourceAsStream(resourcePath)) {
            if (is == null) {
                throw new ConfigurationException("Resource not found: " + resourcePath);
            }
            ConfigParser parser = ConfigParserFactory.getParserForFile(resourcePath);
            Map<String, Object> data = parser.parse(is);
            return new ConfigSection(data);
        } catch (IOException e) {
            throw ConfigurationException.loadError(resourcePath, e);
        }
    }

    /**
     * Saves a configuration to disk.
     *
     * @param name   the configuration name
     * @param config the configuration to save
     */
    public void saveConfig(String name, ConfigSection config) {
        Path fullPath = resolvePath(name);
        String cacheKey = fullPath.toString();

        configurationCache.put(cacheKey, config);
        pendingSaves.put(cacheKey, System.currentTimeMillis());

        if (saveDelay == null || saveDelay.isZero()) {
            flushSave(fullPath, config);
        }
    }

    /**
     * Immediately saves all pending configurations.
     */
    public void flush() {
        flushPendingSaves();
    }

    /**
     * Reloads a configuration from disk.
     *
     * @param name the configuration name
     * @return the reloaded ConfigSection
     */
    public ConfigSection reloadConfig(String name) {
        Path fullPath = resolvePath(name);
        String cacheKey = fullPath.toString();

        ConfigSection oldConfig = configurationCache.get(cacheKey);
        ConfigSection newConfig = loadConfig(fullPath);
        configurationCache.put(cacheKey, newConfig);

        // Remove from pending saves since we just reloaded
        pendingSaves.remove(cacheKey);

        log.debug("Reloaded configuration: {}", name);
        notifyListeners(fullPath, name, oldConfig, newConfig,
                ConfigurationChangeListener.ConfigurationChangeEvent.ChangeType.MODIFIED);

        return newConfig;
    }

    /**
     * Clears the cache for a specific configuration.
     *
     * @param name the configuration name
     */
    public void invalidate(String name) {
        Path fullPath = resolvePath(name);
        configurationCache.remove(fullPath.toString());
    }

    /**
     * Clears the entire configuration cache.
     */
    public void invalidateAll() {
        configurationCache.clear();
    }

    /**
     * Adds a listener for configuration changes.
     *
     * @param listener the listener to add
     */
    public void addChangeListener(ConfigurationChangeListener listener) {
        changeListeners.add(listener);
    }

    /**
     * Removes a configuration change listener.
     *
     * @param listener the listener to remove
     */
    public void removeChangeListener(ConfigurationChangeListener listener) {
        changeListeners.remove(listener);
    }

    /**
     * Gets all loaded configuration names.
     *
     * @return set of configuration names
     */
    public Set<String> getLoadedConfigurations() {
        Set<String> names = new HashSet<>();
        for (String path : configurationCache.keySet()) {
            Path p = Paths.get(path);
            if (p.startsWith(baseDirectory)) {
                names.add(baseDirectory.relativize(p).toString());
            } else {
                names.add(path);
            }
        }
        return names;
    }

    /**
     * Checks if a configuration is loaded.
     *
     * @param name the configuration name
     * @return true if loaded
     */
    public boolean isLoaded(String name) {
        Path fullPath = resolvePath(name);
        return configurationCache.containsKey(fullPath.toString());
    }

    /**
     * Gets the base directory for configurations.
     *
     * @return the base directory path
     */
    public Path getBaseDirectory() {
        return baseDirectory;
    }

    // ---- Private methods ----

    private Path resolvePath(String name) {
        Path path = Paths.get(name);
        if (path.isAbsolute()) {
            return path;
        }
        return baseDirectory.resolve(name);
    }

    private ConfigSection loadConfig(Path path) {
        if (!Files.exists(path)) {
            throw ConfigurationException.loadError(path.toString(),
                    new NoSuchFileException(path.toString()));
        }
        ConfigParser parser = ConfigParserFactory.getParserForFile(path.toString());
        Map<String, Object> data = parser.parse(path);
        return new ConfigSection(data);
    }

    private void flushPendingSaves() {
        // Take a snapshot of keys to process, then remove them individually
        // to avoid losing entries added concurrently during the flush.
        Set<String> keysToSave = new java.util.HashSet<>(pendingSaves.keySet());

        for (String pathStr : keysToSave) {
            // Remove the entry atomically; if a newer save was registered
            // concurrently, it will be picked up in the next flush cycle.
            pendingSaves.remove(pathStr);
            ConfigSection config = configurationCache.get(pathStr);
            if (config != null) {
                Path path = Paths.get(pathStr);
                flushSave(path, config);
            }
        }
    }

    private void flushSave(Path path, ConfigSection config) {
        try {
            ConfigParser parser = ConfigParserFactory.getParserForFile(path.toString());
            parser.write(path, config.toMap());
            log.debug("Saved configuration: {}", path);
        } catch (Exception e) {
            log.error("Failed to save configuration: {}", path, e);
        }
    }

    private void registerWatcher(Path filePath) {
        if (watchedFiles.contains(filePath.toString())) {
            return;
        }

        try {
            Path parent = filePath.getParent();
            if (parent != null && !watchServices.containsKey(parent)) {
                WatchService watchService = FileSystems.getDefault().newWatchService();
                parent.register(watchService, StandardWatchEventKinds.ENTRY_MODIFY);
                watchServices.put(parent, watchService);
                log.debug("Registered file watcher for directory: {}", parent);
            }
            watchedFiles.add(filePath.toString());
        } catch (IOException e) {
            log.warn("Failed to register file watcher for: {}", filePath, e);
        }
    }

    private void pollWatchers() {
        try {
            for (Map.Entry<Path, WatchService> entry : watchServices.entrySet()) {
                WatchKey key;
                while ((key = entry.getValue().poll()) != null) {
                    for (WatchEvent<?> event : key.pollEvents()) {
                        if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                            continue;
                        }

                        Path changed = (Path) event.context();
                        Path fullPath = entry.getKey().resolve(changed);
                        String fullPathStr = fullPath.toString();

                        if (watchedFiles.contains(fullPathStr) && !pendingSaves.containsKey(fullPathStr)) {
                            // Reload the config
                            ConfigSection oldConfig = configurationCache.get(fullPathStr);
                            try {
                                ConfigSection newConfig = loadConfig(fullPath);
                                configurationCache.put(fullPathStr, newConfig);

                                String name = baseDirectory.relativize(fullPath).toString();
                                log.info("Configuration auto-reloaded: {}", name);
                                notifyListeners(fullPath, name, oldConfig, newConfig,
                                        ConfigurationChangeListener.ConfigurationChangeEvent.ChangeType.MODIFIED);
                            } catch (Exception e) {
                                log.error("Failed to auto-reload configuration: {}", fullPath, e);
                            }
                        }
                    }
                    key.reset();
                }
            }
        } catch (Exception e) {
            log.error("Error in config watcher", e);
        }
    }

    private void closeWatchers() {
        for (WatchService watchService : watchServices.values()) {
            try {
                watchService.close();
            } catch (IOException e) {
                log.warn("Error closing watch service", e);
            }
        }
        watchServices.clear();
    }

    private void notifyListeners(Path path, String name, ConfigSection oldConfig,
            ConfigSection newConfig,
            ConfigurationChangeListener.ConfigurationChangeEvent.ChangeType changeType) {
        if (changeListeners.isEmpty()) {
            return;
        }

        var event = new ConfigurationChangeListener.ConfigurationChangeEvent(
                path, name, oldConfig, newConfig, changeType);

        for (ConfigurationChangeListener listener : changeListeners) {
            try {
                listener.onConfigurationChanged(event);
            } catch (Exception e) {
                log.error("Error in configuration change listener", e);
            }
        }
    }

    /**
     * Creates a new builder for ConfigurationManager.
     *
     * @return a new builder
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Creates a simple ConfigurationManager with defaults.
     *
     * @param baseDirectory the base directory for configurations
     * @return a new ConfigurationManager
     */
    public static ConfigurationManager create(Path baseDirectory) {
        return builder().withBaseDirectory(baseDirectory).build();
    }

    /**
     * Builder for ConfigurationManager.
     */
    public static class Builder {
        private Path baseDirectory = Paths.get(".");
        private boolean autoReload = false;
        private java.time.Duration saveDelay = java.time.Duration.ofSeconds(1);
        private java.time.Duration reloadDebounce = java.time.Duration.ofMillis(500);

        /**
         * Sets the base directory for configuration files.
         *
         * @param baseDirectory the base directory
         * @return this builder
         */
        public Builder withBaseDirectory(Path baseDirectory) {
            this.baseDirectory = baseDirectory;
            return this;
        }

        /**
         * Sets the base directory for configuration files.
         *
         * @param baseDirectory the base directory path string
         * @return this builder
         */
        public Builder withBaseDirectory(String baseDirectory) {
            this.baseDirectory = Paths.get(baseDirectory);
            return this;
        }

        /**
         * Enables or disables automatic configuration reloading on file changes.
         *
         * @param autoReload true to enable auto-reload
         * @return this builder
         */
        public Builder withAutoReload(boolean autoReload) {
            this.autoReload = autoReload;
            return this;
        }

        /**
         * Sets the delay before saving configuration changes.
         *
         * @param saveDelay the save delay (null or zero for immediate saves)
         * @return this builder
         */
        public Builder withSaveDelay(java.time.Duration saveDelay) {
            this.saveDelay = saveDelay;
            return this;
        }

        /**
         * Sets the debounce time for reload detection.
         *
         * @param reloadDebounce the debounce duration
         * @return this builder
         */
        public Builder withReloadDebounce(java.time.Duration reloadDebounce) {
            this.reloadDebounce = reloadDebounce;
            return this;
        }

        /**
         * Builds the ConfigurationManager.
         *
         * @return a new ConfigurationManager
         */
        public ConfigurationManager build() {
            return new ConfigurationManager(this);
        }
    }
}
