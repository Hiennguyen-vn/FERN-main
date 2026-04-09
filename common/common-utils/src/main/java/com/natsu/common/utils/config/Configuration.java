package com.natsu.common.utils.config;

import com.natsu.common.utils.config.parser.ConfigParser;
import com.natsu.common.utils.config.parser.ConfigParserFactory;

import java.io.InputStream;
import java.io.Reader;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fluent builder for creating ConfigSection instances from various sources.
 * Includes a static cache for file-based configurations to avoid repeated disk reads.
 *
 * <p>Example usage:
 * <pre>
 * // From file (cached)
 * ConfigSection config = Configuration.fromFile("config.yml").load();
 *
 * // From file (bypass cache)
 * ConfigSection config = Configuration.fromFile("config.yml").noCache().load();
 *
 * // From string
 * ConfigSection config = Configuration.fromYaml(yamlString).load();
 *
 * // From resource
 * ConfigSection config = Configuration.fromResource("defaults.json").load();
 *
 * // With defaults
 * ConfigSection config = Configuration.fromFile("config.yml")
 *     .withDefaults(defaults)
 *     .load();
 * </pre>
 */
public final class Configuration {

    // Static cache for file-based configurations
    private static final Map<String, CachedConfig> configCache = new ConcurrentHashMap<>();

    private static class CachedConfig {
        final ConfigSection config;
        final long loadedAt;
        final long fileLastModified;

        CachedConfig(ConfigSection config, long fileLastModified) {
            this.config = config;
            this.loadedAt = System.currentTimeMillis();
            this.fileLastModified = fileLastModified;
        }
    }

    private Configuration() {
        // Utility class
    }

    /**
     * Gets a cached configuration by file path, or null if not cached.
     *
     * @param path the file path
     * @return the cached ConfigSection, or null
     */
    public static ConfigSection getCached(String path) {
        CachedConfig cached = configCache.get(normalizePath(path));
        return cached != null ? cached.config : null;
    }

    /**
     * Gets a cached configuration by file path, or null if not cached.
     *
     * @param path the file path
     * @return the cached ConfigSection, or null
     */
    public static ConfigSection getCached(Path path) {
        return getCached(path.toString());
    }

    /**
     * Checks if a configuration is cached.
     *
     * @param path the file path
     * @return true if cached
     */
    public static boolean isCached(String path) {
        return configCache.containsKey(normalizePath(path));
    }

    /**
     * Invalidates a cached configuration.
     *
     * @param path the file path to invalidate
     */
    public static void invalidate(String path) {
        configCache.remove(normalizePath(path));
    }

    /**
     * Invalidates a cached configuration.
     *
     * @param path the file path to invalidate
     */
    public static void invalidate(Path path) {
        invalidate(path.toString());
    }

    /**
     * Clears all cached configurations.
     */
    public static void invalidateAll() {
        configCache.clear();
    }

    /**
     * Gets all cached configuration paths.
     *
     * @return set of cached paths
     */
    public static Set<String> getCachedPaths() {
        return Set.copyOf(configCache.keySet());
    }

    /**
     * Gets the number of cached configurations.
     *
     * @return cache size
     */
    public static int cacheSize() {
        return configCache.size();
    }

    private static String normalizePath(String path) {
        return Paths.get(path).toAbsolutePath().normalize().toString();
    }

    static void cacheConfig(String path, ConfigSection config, long fileLastModified) {
        configCache.put(normalizePath(path), new CachedConfig(config, fileLastModified));
    }

    static CachedConfig getCachedInternal(String path) {
        return configCache.get(normalizePath(path));
    }

    /**
     * Creates a builder to load configuration from a file.
     *
     * @param path the file path
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromFile(Path path) {
        return new ConfigurationBuilder().file(path);
    }

    /**
     * Creates a builder to load configuration from a file.
     *
     * @param path the file path string
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromFile(String path) {
        return new ConfigurationBuilder().file(path);
    }

    /**
     * Creates a builder to load configuration from a classpath resource.
     *
     * @param resourcePath the resource path
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromResource(String resourcePath) {
        return new ConfigurationBuilder().resource(resourcePath);
    }

    /**
     * Creates a builder to load configuration from a classpath resource.
     *
     * @param resourcePath the resource path
     * @param classLoader the class loader to use
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromResource(String resourcePath, ClassLoader classLoader) {
        return new ConfigurationBuilder().resource(resourcePath, classLoader);
    }

    /**
     * Creates a builder to load YAML configuration from a string.
     *
     * @param content the YAML content
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromYaml(String content) {
        return new ConfigurationBuilder().yaml(content);
    }

    /**
     * Creates a builder to load JSON configuration from a string.
     *
     * @param content the JSON content
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromJson(String content) {
        return new ConfigurationBuilder().json(content);
    }

    /**
     * Creates a builder to load TOML configuration from a string.
     *
     * @param content the TOML content
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromToml(String content) {
        return new ConfigurationBuilder().toml(content);
    }

    /**
     * Creates a builder to load configuration from an input stream.
     *
     * @param inputStream the input stream
     * @param format the configuration format
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromStream(InputStream inputStream, ConfigFormat format) {
        return new ConfigurationBuilder().stream(inputStream, format);
    }

    /**
     * Creates a builder to load configuration from a reader.
     *
     * @param reader the reader
     * @param format the configuration format
     * @return a new ConfigurationBuilder
     */
    public static ConfigurationBuilder fromReader(Reader reader, ConfigFormat format) {
        return new ConfigurationBuilder().reader(reader, format);
    }

    /**
     * Creates an empty ConfigSection.
     *
     * @return an empty ConfigSection
     */
    public static ConfigSection empty() {
        return ConfigSection.empty();
    }

    /**
     * Creates a ConfigSection from a map.
     *
     * @param data the configuration data
     * @return a new ConfigSection
     */
    public static ConfigSection of(Map<String, Object> data) {
        return ConfigSection.of(data);
    }

    /**
     * Builder for loading configurations from various sources.
     */
    public static class ConfigurationBuilder {
        private Source source;
        private ConfigSection defaults;
        private boolean mergeDefaults = true;
        private boolean useCache = true;

        private enum SourceType {
            FILE, RESOURCE, STRING, STREAM, READER
        }

        private static class Source {
            SourceType type;
            Object value;
            ConfigFormat format;
            ClassLoader classLoader;
        }

        ConfigurationBuilder() {
        }

        /**
         * Disables caching for this load operation.
         * The configuration will be loaded fresh from disk.
         *
         * @return this builder
         */
        public ConfigurationBuilder noCache() {
            this.useCache = false;
            return this;
        }

        /**
         * Enables or disables caching for this load operation.
         *
         * @param useCache true to use cache (default), false to load fresh
         * @return this builder
         */
        public ConfigurationBuilder cache(boolean useCache) {
            this.useCache = useCache;
            return this;
        }

        /**
         * Loads configuration from a file.
         */
        public ConfigurationBuilder file(Path path) {
            this.source = new Source();
            this.source.type = SourceType.FILE;
            this.source.value = path;
            this.source.format = ConfigFormat.fromFilePath(path.toString()).orElse(null);
            return this;
        }

        /**
         * Loads configuration from a file.
         */
        public ConfigurationBuilder file(String path) {
            this.source = new Source();
            this.source.type = SourceType.FILE;
            this.source.value = Path.of(path);
            this.source.format = ConfigFormat.fromFilePath(path).orElse(null);
            return this;
        }

        /**
         * Loads configuration from a classpath resource.
         */
        public ConfigurationBuilder resource(String resourcePath) {
            return resource(resourcePath, Thread.currentThread().getContextClassLoader());
        }

        /**
         * Loads configuration from a classpath resource.
         */
        public ConfigurationBuilder resource(String resourcePath, ClassLoader classLoader) {
            this.source = new Source();
            this.source.type = SourceType.RESOURCE;
            this.source.value = resourcePath;
            this.source.format = ConfigFormat.fromFilePath(resourcePath).orElse(null);
            this.source.classLoader = classLoader;
            return this;
        }

        /**
         * Loads YAML configuration from a string.
         */
        public ConfigurationBuilder yaml(String content) {
            this.source = new Source();
            this.source.type = SourceType.STRING;
            this.source.value = content;
            this.source.format = ConfigFormat.YAML;
            return this;
        }

        /**
         * Loads JSON configuration from a string.
         */
        public ConfigurationBuilder json(String content) {
            this.source = new Source();
            this.source.type = SourceType.STRING;
            this.source.value = content;
            this.source.format = ConfigFormat.JSON;
            return this;
        }

        /**
         * Loads TOML configuration from a string.
         */
        public ConfigurationBuilder toml(String content) {
            this.source = new Source();
            this.source.type = SourceType.STRING;
            this.source.value = content;
            this.source.format = ConfigFormat.TOML;
            return this;
        }

        /**
         * Loads configuration from an input stream.
         */
        public ConfigurationBuilder stream(InputStream inputStream, ConfigFormat format) {
            this.source = new Source();
            this.source.type = SourceType.STREAM;
            this.source.value = inputStream;
            this.source.format = format;
            return this;
        }

        /**
         * Loads configuration from a reader.
         */
        public ConfigurationBuilder reader(Reader reader, ConfigFormat format) {
            this.source = new Source();
            this.source.type = SourceType.READER;
            this.source.value = reader;
            this.source.format = format;
            return this;
        }

        /**
         * Sets default values to use when keys are missing.
         *
         * @param defaults the default configuration
         * @return this builder
         */
        public ConfigurationBuilder withDefaults(ConfigSection defaults) {
            this.defaults = defaults;
            return this;
        }

        /**
         * Sets default values from a map.
         *
         * @param defaults the default values
         * @return this builder
         */
        public ConfigurationBuilder withDefaults(Map<String, Object> defaults) {
            this.defaults = ConfigSection.of(defaults);
            return this;
        }

        /**
         * Controls whether defaults are merged with loaded configuration.
         *
         * @param merge true to merge (default), false to only use defaults for missing top-level keys
         * @return this builder
         */
        public ConfigurationBuilder mergeDefaults(boolean merge) {
            this.mergeDefaults = merge;
            return this;
        }

        /**
         * Loads and returns the configuration.
         * For file-based configurations, uses cache by default unless noCache() was called.
         *
         * @return the loaded ConfigSection
         * @throws ConfigurationException if loading fails
         */
        public ConfigSection load() {
            if (source == null) {
                return defaults != null ? defaults : ConfigSection.empty();
            }

            if (source.format == null) {
                throw new ConfigurationException("Could not determine configuration format");
            }

            // Check cache for file-based configurations
            if (useCache && source.type == SourceType.FILE) {
                Path filePath = (Path) source.value;
                String pathStr = filePath.toString();
                
                try {
                    java.nio.file.attribute.BasicFileAttributes attrs = 
                        java.nio.file.Files.readAttributes(filePath, java.nio.file.attribute.BasicFileAttributes.class);
                    long fileModified = attrs.lastModifiedTime().toMillis();
                    
                    Configuration.CachedConfig cached = Configuration.getCachedInternal(pathStr);
                    if (cached != null && cached.fileLastModified == fileModified) {
                        // Return cached config if file hasn't changed
                        if (defaults != null && mergeDefaults) {
                            Map<String, Object> mergedData = mergeDeep(defaults.toMap(), cached.config.toMap());
                            return new ConfigSection(mergedData);
                        }
                        return cached.config;
                    }
                } catch (java.io.IOException e) {
                    // File might not exist yet, continue with loading
                }
            }

            ConfigParser parser = ConfigParserFactory.getParser(source.format);
            Map<String, Object> data;

            switch (source.type) {
                case FILE:
                    Path filePath = (Path) source.value;
                    data = parser.parse(filePath);
                    
                    // Cache the loaded config
                    if (useCache) {
                        try {
                            java.nio.file.attribute.BasicFileAttributes attrs = 
                                java.nio.file.Files.readAttributes(filePath, java.nio.file.attribute.BasicFileAttributes.class);
                            Configuration.cacheConfig(filePath.toString(), new ConfigSection(new LinkedHashMap<>(data)), 
                                attrs.lastModifiedTime().toMillis());
                        } catch (java.io.IOException ignored) {
                            // Caching failed, but we can still return the config
                        }
                    }
                    break;
                case RESOURCE:
                    String resourcePath = (String) source.value;
                    ClassLoader cl = source.classLoader != null ? source.classLoader :
                            Thread.currentThread().getContextClassLoader();
                    try (InputStream is = cl.getResourceAsStream(resourcePath)) {
                        if (is == null) {
                            throw new ConfigurationException("Resource not found: " + resourcePath);
                        }
                        data = parser.parse(is);
                    } catch (Exception e) {
                        if (e instanceof ConfigurationException) throw (ConfigurationException) e;
                        throw ConfigurationException.loadError(resourcePath, e);
                    }
                    break;
                case STRING:
                    data = parser.parseString((String) source.value);
                    break;
                case STREAM:
                    data = parser.parse((InputStream) source.value);
                    break;
                case READER:
                    data = parser.parse((Reader) source.value);
                    break;
                default:
                    throw new ConfigurationException("Unknown source type");
            }

            // Apply defaults if present
            if (defaults != null && mergeDefaults) {
                data = mergeDeep(defaults.toMap(), data);
            }

            return new ConfigSection(data);
        }

        @SuppressWarnings("unchecked")
        private Map<String, Object> mergeDeep(Map<String, Object> defaults, Map<String, Object> overrides) {
            Map<String, Object> result = new LinkedHashMap<>(defaults);

            for (Map.Entry<String, Object> entry : overrides.entrySet()) {
                String key = entry.getKey();
                Object overrideValue = entry.getValue();
                Object defaultValue = result.get(key);

                if (defaultValue instanceof Map && overrideValue instanceof Map) {
                    result.put(key, mergeDeep(
                            (Map<String, Object>) defaultValue,
                            (Map<String, Object>) overrideValue
                    ));
                } else {
                    result.put(key, overrideValue);
                }
            }

            return result;
        }
    }
}
