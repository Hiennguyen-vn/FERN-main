# Configuration Utilities Guide

A flexible, type-safe configuration management library supporting **YAML**, **JSON**, and **TOML** formats with built-in caching and file watching.

## Table of Contents

- [Quick Start](#quick-start)
- [Loading Configurations](#loading-configurations)
  - [From Files](#from-files)
  - [From Strings](#from-strings)
  - [From Resources](#from-resources)
- [Accessing Values](#accessing-values)
  - [Basic Types](#basic-types)
  - [Nested Paths](#nested-paths)
  - [Lists](#lists)
  - [Durations](#durations)
  - [Required Values](#required-values)
- [Caching](#caching)
  - [How Caching Works](#how-caching-works)
  - [Cache Management](#cache-management)
  - [Bypassing Cache](#bypassing-cache)
- [Configuration Manager](#configuration-manager)
  - [Auto-Reload](#auto-reload)
  - [Change Listeners](#change-listeners)
- [Default Values](#default-values)
- [Supported Formats](#supported-formats)
- [API Reference](#api-reference)

---

## Quick Start

```java
// Load a YAML configuration file (cached by default)
ConfigSection config = Configuration.fromFile("config.yml").load();

// Access values with type safety
String host = config.getString("database.host", "localhost");
int port = config.getInt("database.port", 5432);
boolean enabled = config.getBoolean("features.caching", true);
Duration timeout = config.getDuration("connection.timeout");
```

---

## Loading Configurations

### From Files

Load configuration from any supported file format. The format is auto-detected from the file extension.

```java
// YAML file
ConfigSection yaml = Configuration.fromFile("config.yml").load();
ConfigSection yaml2 = Configuration.fromFile("config.yaml").load();

// JSON file
ConfigSection json = Configuration.fromFile("settings.json").load();

// TOML file
ConfigSection toml = Configuration.fromFile("app.toml").load();

// Using Path object
Path configPath = Paths.get("/etc/myapp/config.yml");
ConfigSection config = Configuration.fromFile(configPath).load();
```

### From Strings

Parse configuration directly from strings:

```java
// YAML string
String yamlContent = """
    server:
      host: localhost
      port: 8080
    """;
ConfigSection config = Configuration.fromYaml(yamlContent).load();

// JSON string
String jsonContent = """
    {
      "server": {
        "host": "localhost",
        "port": 8080
      }
    }
    """;
ConfigSection config = Configuration.fromJson(jsonContent).load();

// TOML string
String tomlContent = """
    [server]
    host = "localhost"
    port = 8080
    """;
ConfigSection config = Configuration.fromToml(tomlContent).load();
```

### From Resources

Load configuration from classpath resources:

```java
// Load from classpath
ConfigSection defaults = Configuration.fromResource("defaults.yml").load();

// With custom classloader
ConfigSection config = Configuration.fromResource("config.json", MyClass.class.getClassLoader()).load();
```

---

## Accessing Values

### Basic Types

```java
ConfigSection config = Configuration.fromFile("config.yml").load();

// Strings
String name = config.getString("app.name");
String nameWithDefault = config.getString("app.name", "MyApp");

// Integers
Integer count = config.getInt("max.connections");
int countWithDefault = config.getInt("max.connections", 100);

// Longs
Long bigNumber = config.getLong("file.size.limit");
long bigNumberWithDefault = config.getLong("file.size.limit", 1000000L);

// Doubles
Double rate = config.getDouble("sample.rate");
double rateWithDefault = config.getDouble("sample.rate", 0.5);

// Booleans (accepts true/false, yes/no, 1/0)
Boolean enabled = config.getBoolean("feature.enabled");
boolean enabledWithDefault = config.getBoolean("feature.enabled", false);
```

### Nested Paths

Access nested values using dot notation:

```yaml
# config.yml
database:
  primary:
    host: localhost
    port: 5432
    connection:
      timeout: 30s
      pool:
        min: 5
        max: 20
```

```java
ConfigSection config = Configuration.fromFile("config.yml").load();

// Access deeply nested values
String host = config.getString("database.primary.host");
int port = config.getInt("database.primary.port");
int maxPool = config.getInt("database.primary.connection.pool.max");

// Get a subsection
ConfigSection dbConfig = config.getSection("database.primary");
String host = dbConfig.getString("host");
int minPool = dbConfig.getInt("connection.pool.min");
```

### Lists

```yaml
# config.yml
servers:
  - host1.example.com
  - host2.example.com
  - host3.example.com
ports:
  - 8080
  - 8081
  - 8082
```

```java
ConfigSection config = Configuration.fromFile("config.yml").load();

// String list
List<String> servers = config.getStringList("servers");

// Integer list
List<Integer> ports = config.getIntList("ports");

// Custom mapping
List<URI> uris = config.getList("servers", s -> URI.create("http://" + s));
```

### Durations

Parse human-readable duration strings:

```yaml
# config.yml
timeouts:
  connect: 30s
  read: 5m
  idle: 1h
  session: 7d
  poll: 500ms
```

```java
ConfigSection config = Configuration.fromFile("config.yml").load();

Duration connect = config.getDuration("timeouts.connect");  // 30 seconds
Duration read = config.getDuration("timeouts.read");        // 5 minutes
Duration idle = config.getDuration("timeouts.idle");        // 1 hour
Duration session = config.getDuration("timeouts.session");  // 7 days
Duration poll = config.getDuration("timeouts.poll");        // 500 milliseconds

// With default
Duration timeout = config.getDuration("timeouts.missing", Duration.ofSeconds(10));
```

**Supported duration formats:**
- `ms` - milliseconds (e.g., `500ms`)
- `s` - seconds (e.g., `30s`)
- `m` - minutes (e.g., `5m`)
- `h` - hours (e.g., `1h`)
- `d` - days (e.g., `7d`)

### Required Values

Throw an exception if a value is missing:

```java
ConfigSection config = Configuration.fromFile("config.yml").load();

// Throws ConfigurationException if key doesn't exist
String apiKey = config.getRequired("api.key", String.class);
int port = config.getRequired("server.port", Integer.class);
```

---

## Caching

### How Caching Works

File-based configurations are **cached by default** to avoid repeated disk reads. The cache:

1. Stores loaded configurations in memory
2. Tracks file modification times
3. Automatically invalidates when files change
4. Is thread-safe for concurrent access

```java
// First call: reads from disk and caches
ConfigSection config1 = Configuration.fromFile("config.yml").load();

// Second call: returns cached version (no disk read)
ConfigSection config2 = Configuration.fromFile("config.yml").load();

// If the file was modified, it will be re-read automatically
```

### Cache Management

```java
// Check if a config is cached
boolean cached = Configuration.isCached("config.yml");

// Get cached config directly (returns null if not cached)
ConfigSection config = Configuration.getCached("config.yml");

// Invalidate a specific config
Configuration.invalidate("config.yml");

// Clear the entire cache
Configuration.invalidateAll();

// Get all cached paths
Set<String> cachedPaths = Configuration.getCachedPaths();

// Get cache size
int size = Configuration.cacheSize();
```

### Bypassing Cache

Force a fresh read from disk:

```java
// Bypass cache for this load
ConfigSection fresh = Configuration.fromFile("config.yml")
    .noCache()
    .load();

// Or explicitly
ConfigSection fresh = Configuration.fromFile("config.yml")
    .cache(false)
    .load();
```

---

## Configuration Manager

For more advanced use cases, use `ConfigurationManager` which provides:
- Centralized configuration management
- Automatic file watching and reload
- Change notifications
- Delayed saves

### Basic Usage

```java
ConfigurationManager manager = ConfigurationManager.builder()
    .withBaseDirectory(Paths.get("/app/config"))
    .withAutoReload(true)
    .withSaveDelay(Duration.ofSeconds(1))
    .build()
    .start();

// Load configurations (cached automatically)
ConfigSection appConfig = manager.getConfig("application.yml");
ConfigSection dbConfig = manager.getConfig("database.json");

// Reload manually
ConfigSection reloaded = manager.reloadConfig("application.yml");

// Save configuration
manager.saveConfig("output.yml", config);

// Clean up
manager.close();
```

### Auto-Reload

Enable automatic configuration reloading when files change:

```java
ConfigurationManager manager = ConfigurationManager.builder()
    .withBaseDirectory(Paths.get("/app/config"))
    .withAutoReload(true)
    .withReloadDebounce(Duration.ofMillis(500))  // Debounce rapid changes
    .build()
    .start();

// Configurations are automatically reloaded when files change
ConfigSection config = manager.getConfig("app.yml");
```

### Change Listeners

Get notified when configurations change:

```java
manager.addChangeListener(event -> {
    System.out.println("Config changed: " + event.configName());
    System.out.println("Change type: " + event.changeType());
    
    ConfigSection oldConfig = event.oldConfig();
    ConfigSection newConfig = event.newConfig();
    
    // React to changes
    if ("database.yml".equals(event.configName())) {
        reconnectDatabase(newConfig);
    }
});
```

---

## Default Values

Merge configurations with defaults:

```java
// Load defaults
ConfigSection defaults = Configuration.fromResource("defaults.yml").load();

// Load user config with defaults
ConfigSection config = Configuration.fromFile("config.yml")
    .withDefaults(defaults)
    .load();

// Missing values in config.yml will use values from defaults.yml
```

**Deep merging** is performed automatically:

```yaml
# defaults.yml
database:
  host: localhost
  port: 5432
  pool:
    min: 5
    max: 20

# config.yml (user overrides)
database:
  host: production-db.example.com
  pool:
    max: 50
```

Result after merge:
```yaml
database:
  host: production-db.example.com  # overridden
  port: 5432                        # from defaults
  pool:
    min: 5                          # from defaults
    max: 50                         # overridden
```

---

## Supported Formats

### YAML (.yml, .yaml)

```yaml
server:
  host: localhost
  port: 8080

database:
  connection:
    url: jdbc:postgresql://localhost:5432/mydb
    
features:
  - authentication
  - caching
  - logging
```

### JSON (.json)

```json
{
  "server": {
    "host": "localhost",
    "port": 8080
  },
  "database": {
    "connection": {
      "url": "jdbc:postgresql://localhost:5432/mydb"
    }
  },
  "features": ["authentication", "caching", "logging"]
}
```

### TOML (.toml)

```toml
[server]
host = "localhost"
port = 8080

[database.connection]
url = "jdbc:postgresql://localhost:5432/mydb"

features = ["authentication", "caching", "logging"]
```

---

## API Reference

### Configuration (Static Methods)

| Method | Description |
|--------|-------------|
| `fromFile(path)` | Load from file (cached) |
| `fromYaml(string)` | Parse YAML string |
| `fromJson(string)` | Parse JSON string |
| `fromToml(string)` | Parse TOML string |
| `fromResource(path)` | Load from classpath |
| `getCached(path)` | Get cached config |
| `isCached(path)` | Check if cached |
| `invalidate(path)` | Remove from cache |
| `invalidateAll()` | Clear cache |
| `empty()` | Create empty config |

### ConfigurationBuilder

| Method | Description |
|--------|-------------|
| `.noCache()` | Bypass cache |
| `.cache(boolean)` | Enable/disable cache |
| `.withDefaults(config)` | Set default values |
| `.mergeDefaults(boolean)` | Deep merge or replace |
| `.load()` | Load and return ConfigSection |

### ConfigSection

| Method | Description |
|--------|-------------|
| `getString(key)` | Get string value |
| `getInt(key)` | Get integer value |
| `getLong(key)` | Get long value |
| `getDouble(key)` | Get double value |
| `getBoolean(key)` | Get boolean value |
| `getDuration(key)` | Get Duration value |
| `getStringList(key)` | Get list of strings |
| `getIntList(key)` | Get list of integers |
| `getSection(key)` | Get nested section |
| `getRequired(key, type)` | Get required value |
| `contains(key)` | Check if key exists |
| `getKeys(deep)` | Get all keys |
| `set(key, value)` | Set a value |
| `toMap()` | Convert to Map |

### ConfigurationManager

| Method | Description |
|--------|-------------|
| `getConfig(name)` | Load/get cached config |
| `reloadConfig(name)` | Force reload |
| `saveConfig(name, config)` | Save to file |
| `invalidate(name)` | Remove from cache |
| `addChangeListener(listener)` | Listen for changes |
| `start()` | Start manager |
| `close()` | Stop and cleanup |

---

## Examples

### Complete Application Setup

```java
public class AppConfig {
    private static final ConfigurationManager manager;
    private static ConfigSection appConfig;
    
    static {
        manager = ConfigurationManager.builder()
            .withBaseDirectory(Paths.get(System.getProperty("config.dir", "config")))
            .withAutoReload(true)
            .build()
            .start();
        
        // Listen for changes
        manager.addChangeListener(event -> {
            if ("application.yml".equals(event.configName())) {
                appConfig = event.newConfig();
                onConfigReload();
            }
        });
    }
    
    public static ConfigSection get() {
        if (appConfig == null) {
            appConfig = manager.getConfig("application.yml");
        }
        return appConfig;
    }
    
    public static String getDatabaseHost() {
        return get().getString("database.host", "localhost");
    }
    
    public static int getDatabasePort() {
        return get().getInt("database.port", 5432);
    }
    
    public static Duration getConnectionTimeout() {
        return get().getDuration("database.timeout", Duration.ofSeconds(30));
    }
    
    private static void onConfigReload() {
        // Handle configuration changes
        System.out.println("Configuration reloaded!");
    }
    
    public static void shutdown() {
        manager.close();
    }
}
```

### Environment-Specific Configuration

```java
public ConfigSection loadConfig() {
    String env = System.getProperty("app.env", "development");
    
    // Load base defaults
    ConfigSection defaults = Configuration.fromResource("config/defaults.yml").load();
    
    // Load environment-specific config
    ConfigSection envConfig = Configuration.fromFile("config/" + env + ".yml")
        .withDefaults(defaults)
        .load();
    
    return envConfig;
}
```
