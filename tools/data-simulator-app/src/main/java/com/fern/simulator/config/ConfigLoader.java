package com.fern.simulator.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Loads {@link SimulationConfig} from YAML files or built-in presets.
 */
public final class ConfigLoader {

    private static final ObjectMapper YAML_MAPPER = new ObjectMapper(new YAMLFactory())
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.LOWER_CAMEL_CASE)
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final Map<String, String> PRESETS = Map.of(
            "small", "presets/small.yaml",
            "medium", "presets/medium.yaml",
            "large", "presets/large.yaml"
    );

    private ConfigLoader() {
    }

    /**
     * Loads config from a file path, preset name, or the default config.
     *
     * @param configPath optional path to a custom YAML config file
     * @param preset     optional preset name (small, medium, large)
     * @return the parsed config
     */
    public static SimulationConfig load(Path configPath, String preset) {
        try {
            if (configPath != null) {
                return loadFromFile(configPath);
            }
            if (preset != null) {
                return loadPreset(preset);
            }
            return loadDefault();
        } catch (IOException e) {
            throw new ConfigurationException("Failed to load simulation config", e);
        }
    }

    public static SimulationConfig loadFromFile(Path path) throws IOException {
        try (InputStream is = Files.newInputStream(path)) {
            return parseConfig(is);
        }
    }

    public static SimulationConfig loadPreset(String name) throws IOException {
        String resourcePath = PRESETS.get(name.toLowerCase());
        if (resourcePath == null) {
            throw new ConfigurationException(
                    "Unknown preset: " + name + ". Available: " + String.join(", ", PRESETS.keySet()));
        }

        // Load default config as base
        ConfigWrapper base;
        try (InputStream defaultIs = ConfigLoader.class.getClassLoader().getResourceAsStream("default-config.yaml")) {
            if (defaultIs == null) throw new ConfigurationException("Default config missing");
            base = YAML_MAPPER.readValue(defaultIs, ConfigWrapper.class);
        }

        // Load preset overlay
        ConfigWrapper preset;
        try (InputStream is = ConfigLoader.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (is == null) throw new ConfigurationException("Preset resource not found: " + resourcePath);
            preset = YAML_MAPPER.readValue(is, ConfigWrapper.class);
        }

        // Merge: preset simulation overrides default, everything else defaults
        return new SimulationConfig(
                preset.simulation != null && preset.simulation.namespace != null
                        ? preset.simulation.namespace : base.simulation.namespace,
                preset.simulation != null && preset.simulation.startDate != null
                        ? preset.simulation.startDate : base.simulation.startDate,
                preset.simulation != null && preset.simulation.endDate != null
                        ? preset.simulation.endDate : base.simulation.endDate,
                preset.simulation != null && preset.simulation.seed != 0
                        ? preset.simulation.seed : base.simulation.seed,
                preset.simulation != null && preset.simulation.startingRegion != null
                        ? preset.simulation.startingRegion : base.simulation.startingRegion,
                preset.database != null ? preset.database : base.database != null
                        ? base.database : new SimulationConfig.DatabaseConfig(
                        "jdbc:postgresql://localhost:5432/fern", "fern", "fern", false),
                preset.expansion != null ? preset.expansion : base.expansion,
                preset.regions != null ? preset.regions : base.regions,
                preset.probability != null ? preset.probability : base.probability,
                preset.realism != null ? preset.realism : base.realism
        );
    }

    public static SimulationConfig loadDefault() throws IOException {
        try (InputStream is = ConfigLoader.class.getClassLoader().getResourceAsStream("default-config.yaml")) {
            if (is == null) {
                throw new ConfigurationException("Default config resource not found");
            }
            return parseConfig(is);
        }
    }

    private static SimulationConfig parseConfig(InputStream is) throws IOException {
        // The YAML has a top-level wrapper with simulation/database/expansion/regions/probability keys.
        // We parse into a wrapper and then flatten.
        var wrapper = YAML_MAPPER.readValue(is, ConfigWrapper.class);
        return new SimulationConfig(
                wrapper.simulation.namespace,
                wrapper.simulation.startDate,
                wrapper.simulation.endDate,
                wrapper.simulation.seed,
                wrapper.simulation.startingRegion,
                wrapper.database != null ? wrapper.database : new SimulationConfig.DatabaseConfig(
                        "jdbc:postgresql://localhost:5432/fern", "fern", "fern", false),
                wrapper.expansion,
                wrapper.regions,
                wrapper.probability,
                wrapper.realism
        );
    }

    /** Internal wrapper matching the YAML structure. */
    private static class ConfigWrapper {
        public SimulationSection simulation;
        public SimulationConfig.DatabaseConfig database;
        public SimulationConfig.ExpansionConfig expansion;
        public java.util.List<SimulationConfig.RegionConfig> regions;
        public SimulationConfig.ProbabilityConfig probability;
        public SimulationConfig.RealismConfig realism;
    }

    private static class SimulationSection {
        public String namespace;
        public java.time.LocalDate startDate;
        public java.time.LocalDate endDate;
        public long seed;
        public String startingRegion;
    }

    public static class ConfigurationException extends RuntimeException {
        public ConfigurationException(String message) {
            super(message);
        }

        public ConfigurationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
