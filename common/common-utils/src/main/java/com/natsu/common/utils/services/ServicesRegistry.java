package com.natsu.common.utils.services;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Central static registry for all services and configurations.
 *
 * <p>
 * All state is held in static fields — there is no instance, no singleton
 * pattern, and no {@code getDefault()} call. Every method is {@code static}.
 *
 * <h3>Service Locator</h3>
 * 
 * <pre>{@code
 * ServicesRegistry.register(MyService.class, new MyServiceImpl());
 * MyService svc = ServicesRegistry.getService(MyService.class);
 * }</pre>
 *
 * <h3>Configuration Registry</h3>
 * 
 * <pre>{@code
 * ServicesRegistry.registerConfig(DatabaseConfig.postgresql(...));
 * DatabaseConfig db = ServicesRegistry.getConfig("mydb", ServiceCategory.DATABASE);
 * }</pre>
 */
public final class ServicesRegistry {

    // ── Construction forbidden ────────────────────────────────────────────────
    private ServicesRegistry() {
        throw new UnsupportedOperationException("ServicesRegistry is a static utility class");
    }

    // ── Service Locator State ──────────────────────────────────────────────────
    private static final Map<Class<?>, Object> SERVICES = new ConcurrentHashMap<>();
    private static final Map<Object, Runnable> UNREGISTER_HOOKS = new ConcurrentHashMap<>();

    // ── Configuration Registry State ──────────────────────────────────────────
    private record ConfigKey(String name, ServiceCategory category) {
    }

    private static final Map<ConfigKey, ServiceDefinition> CONFIG_REGISTRY = new ConcurrentHashMap<>();
    private static final Map<ServiceCategory, List<Consumer<ServiceDefinition>>> CONFIG_LISTENERS = new ConcurrentHashMap<>();

    // =========================================================================
    // Service Locator API
    // =========================================================================

    /**
     * Registers a service under its concrete class as the lookup key.
     * Use {@link #register(Class, Object)} to register under an interface.
     */
    public static <T> void register(T instance) {
        register(instance, null);
    }

    /** Registers a service with an optional cleanup hook. */
    @SuppressWarnings("unchecked")
    public static <T> void register(T instance, Runnable onUnregister) {
        Objects.requireNonNull(instance, "Service instance cannot be null");
        register((Class<T>) instance.getClass(), instance, onUnregister);
    }

    /** Registers a service under an explicit type (interface or superclass). */
    public static <T> void register(Class<T> type, T instance) {
        register(type, instance, null);
    }

    /** Registers a service under an explicit type with an optional cleanup hook. */
    public static <T> void register(Class<T> type, T instance, Runnable onUnregister) {
        Objects.requireNonNull(type, "Service type cannot be null");
        Objects.requireNonNull(instance, "Service instance cannot be null");

        Object existing = SERVICES.put(type, instance);
        if (existing != null) {
            runUnregisterHook(existing);
        }
        if (onUnregister != null) {
            UNREGISTER_HOOKS.put(instance, onUnregister);
        }
    }

    /**
     * Retrieves a registered service by type.
     *
     * @throws NoSuchElementException if no service of that type is registered
     */
    @SuppressWarnings("unchecked")
    public static <T> T getService(Class<T> type) {
        T service = (T) SERVICES.get(type);
        if (service == null) {
            throw new NoSuchElementException("Service not registered: " + type.getName());
        }
        return service;
    }

    /** Returns the service or {@code null} if not registered. */
    @SuppressWarnings("unchecked")
    public static <T> T getServiceOrNull(Class<T> type) {
        return (T) SERVICES.get(type);
    }

    /** Returns {@code true} if a service of the given type is registered. */
    public static boolean hasService(Class<?> type) {
        return SERVICES.containsKey(type);
    }

    /** Unregisters the service registered under the given type key. */
    public static boolean unregister(Class<?> type) {
        Object instance = SERVICES.remove(type);
        if (instance != null) {
            runUnregisterHook(instance);
            return true;
        }
        return false;
    }

    /** Unregisters a specific instance (scans all type keys). */
    public static boolean unregister(Object instance) {
        boolean removed = false;
        Iterator<Map.Entry<Class<?>, Object>> it = SERVICES.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue() == instance) {
                it.remove();
                removed = true;
            }
        }
        if (removed)
            runUnregisterHook(instance);
        return removed;
    }

    // =========================================================================
    // Configuration Registry API
    // =========================================================================

    /** Registers a {@link ServiceDefinition}. Throws if already registered. */
    public static void registerConfig(ServiceDefinition config) {
        registerConfig(config, false);
    }

    /** Registers a {@link ServiceDefinition}, optionally allowing overwrite. */
    public static void registerConfig(ServiceDefinition config, boolean allowOverwrite) {
        Objects.requireNonNull(config, "Config cannot be null");
        config.validate();

        ConfigKey key = new ConfigKey(config.getName(), config.getServiceCategory());
        if (!allowOverwrite && CONFIG_REGISTRY.containsKey(key)) {
            throw new IllegalStateException(
                    "Configuration already registered: " + config.getDescription());
        }
        CONFIG_REGISTRY.put(key, config);
        notifyConfigListeners(config);
    }

    /**
     * Registers a config only if no config with the same name+category is present.
     */
    public static boolean registerConfigIfAbsent(ServiceDefinition config) {
        Objects.requireNonNull(config, "Config cannot be null");
        config.validate();
        ConfigKey key = new ConfigKey(config.getName(), config.getServiceCategory());
        ServiceDefinition existing = CONFIG_REGISTRY.putIfAbsent(key, config);
        if (existing == null) {
            notifyConfigListeners(config);
            return true;
        }
        return false;
    }

    /** Registers multiple configs. */
    public static void registerAll(ServiceDefinition... configs) {
        for (ServiceDefinition c : configs)
            registerConfig(c);
    }

    /** Registers multiple configs. */
    public static void registerAll(Collection<? extends ServiceDefinition> configs) {
        for (ServiceDefinition c : configs)
            registerConfig(c);
    }

    /**
     * Retrieves a config by name and category.
     *
     * @throws NoSuchElementException if not found
     */
    @SuppressWarnings("unchecked")
    public static <T extends ServiceDefinition> T getConfig(String name, ServiceCategory category) {
        ServiceDefinition config = CONFIG_REGISTRY.get(new ConfigKey(name, category));
        if (config == null) {
            throw new NoSuchElementException(
                    "Config not found: " + category.name().toLowerCase() + ":" + name);
        }
        return (T) config;
    }

    /** Returns the config or {@code null} if not found. */
    @SuppressWarnings("unchecked")
    public static <T extends ServiceDefinition> T getConfigOrNull(String name, ServiceCategory category) {
        return (T) CONFIG_REGISTRY.get(new ConfigKey(name, category));
    }

    /** Returns the config or the supplied default if not found. */
    @SuppressWarnings("unchecked")
    public static <T extends ServiceDefinition> T getConfigOrDefault(String name, ServiceCategory category,
            T defaultConfig) {
        ServiceDefinition config = CONFIG_REGISTRY.get(new ConfigKey(name, category));
        return config != null ? (T) config : defaultConfig;
    }

    /** Returns all configs registered under the given category. */
    @SuppressWarnings("unchecked")
    public static <T extends ServiceDefinition> List<T> getAllConfigs(ServiceCategory category) {
        return CONFIG_REGISTRY.entrySet().stream()
                .filter(e -> e.getKey().category() == category)
                .map(e -> (T) e.getValue())
                .collect(Collectors.toList());
    }

    /** Returns all registered configs across all categories. */
    public static Collection<ServiceDefinition> getAllConfigs() {
        return Collections.unmodifiableCollection(CONFIG_REGISTRY.values());
    }

    /** Returns all config names registered under the given category. */
    public static Set<String> getConfigNames(ServiceCategory category) {
        return CONFIG_REGISTRY.keySet().stream()
                .filter(k -> k.category() == category)
                .map(ConfigKey::name)
                .collect(Collectors.toSet());
    }

    public static boolean containsConfig(String name, ServiceCategory category) {
        return CONFIG_REGISTRY.containsKey(new ConfigKey(name, category));
    }

    public static int countConfigs(ServiceCategory category) {
        return (int) CONFIG_REGISTRY.keySet().stream()
                .filter(k -> k.category() == category).count();
    }

    public static int configSize() {
        return CONFIG_REGISTRY.size();
    }

    public static boolean isEmpty() {
        return CONFIG_REGISTRY.isEmpty() && SERVICES.isEmpty();
    }

    public static boolean unregisterConfig(String name, ServiceCategory category) {
        return CONFIG_REGISTRY.remove(new ConfigKey(name, category)) != null;
    }

    public static boolean unregisterConfig(ServiceDefinition config) {
        return unregisterConfig(config.getName(), config.getServiceCategory());
    }

    public static int clearConfigCategory(ServiceCategory category) {
        List<ConfigKey> toRemove = CONFIG_REGISTRY.keySet().stream()
                .filter(k -> k.category() == category).toList();
        toRemove.forEach(CONFIG_REGISTRY::remove);
        return toRemove.size();
    }

    // =========================================================================
    // Listener API
    // =========================================================================

    public static void onConfigRegister(ServiceCategory category, Consumer<ServiceDefinition> listener) {
        CONFIG_LISTENERS.computeIfAbsent(category, k -> new java.util.concurrent.CopyOnWriteArrayList<>())
                .add(listener);
    }

    public static void removeConfigListeners(ServiceCategory category) {
        CONFIG_LISTENERS.remove(category);
    }

    public static void clearListeners() {
        CONFIG_LISTENERS.clear();
    }

    // =========================================================================
    // Lifecycle / Debug
    // =========================================================================

    /** Clears all services and configs; runs unregister hooks. */
    public static void clear() {
        for (Object instance : new ArrayList<>(SERVICES.values())) {
            runUnregisterHook(instance);
        }
        SERVICES.clear();
        UNREGISTER_HOOKS.clear();
        CONFIG_REGISTRY.clear();
    }

    /** Clears all state including listeners. Useful for tests. */
    public static void reset() {
        clear();
        CONFIG_LISTENERS.clear();
    }

    /** Returns a human-readable summary of registered services and configs. */
    public static String summary() {
        StringBuilder sb = new StringBuilder("ServicesRegistry {\n");
        if (!SERVICES.isEmpty()) {
            sb.append("  Services:\n");
            SERVICES.forEach((type, inst) -> sb.append("    ").append(type.getSimpleName())
                    .append(" -> ").append(inst).append("\n"));
        }
        for (ServiceCategory cat : ServiceCategory.values()) {
            List<ServiceDefinition> cfgs = getAllConfigs(cat);
            if (!cfgs.isEmpty()) {
                sb.append("  ").append(cat.name()).append(":\n");
                cfgs.forEach(c -> sb.append("    ").append(c.getDescription()).append("\n"));
            }
        }
        sb.append("}");
        return sb.toString();
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private static void runUnregisterHook(Object instance) {
        Runnable hook = UNREGISTER_HOOKS.remove(instance);
        if (hook != null) {
            try {
                hook.run();
            } catch (Exception e) {
                System.err.println("[ServicesRegistry] Unregister hook error for "
                        + instance.getClass().getName() + ": " + e.getMessage());
            }
        }
    }

    private static void notifyConfigListeners(ServiceDefinition config) {
        List<Consumer<ServiceDefinition>> listeners = CONFIG_LISTENERS.get(config.getServiceCategory());
        if (listeners == null)
            return;
        for (Consumer<ServiceDefinition> listener : listeners) {
            try {
                listener.accept(config);
            } catch (Exception e) {
                System.err.println("[ServicesRegistry] Config listener error for "
                        + config.getDescription() + ": " + e.getMessage());
            }
        }
    }
}
