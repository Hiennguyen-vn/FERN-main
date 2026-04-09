package com.natsu.common.utils.config;

/**
 * Exception thrown when configuration operations fail.
 */
public class ConfigurationException extends RuntimeException {

    public ConfigurationException(String message) {
        super(message);
    }

    public ConfigurationException(String message, Throwable cause) {
        super(message, cause);
    }

    public ConfigurationException(Throwable cause) {
        super(cause);
    }

    /**
     * Creates an exception for a missing required configuration key.
     *
     * @param key the missing key
     * @return a new ConfigurationException
     */
    public static ConfigurationException missingKey(String key) {
        return new ConfigurationException("Missing required configuration key: " + key);
    }

    /**
     * Creates an exception for an invalid configuration value.
     *
     * @param key the configuration key
     * @param expectedType the expected type
     * @param actualValue the actual value found
     * @return a new ConfigurationException
     */
    public static ConfigurationException invalidValue(String key, Class<?> expectedType, Object actualValue) {
        return new ConfigurationException(String.format(
                "Invalid configuration value for key '%s': expected %s but got %s",
                key,
                expectedType.getSimpleName(),
                actualValue == null ? "null" : actualValue.getClass().getSimpleName()
        ));
    }

    /**
     * Creates an exception for a file loading error.
     *
     * @param filePath the file path that failed to load
     * @param cause the underlying cause
     * @return a new ConfigurationException
     */
    public static ConfigurationException loadError(String filePath, Throwable cause) {
        return new ConfigurationException("Failed to load configuration from: " + filePath, cause);
    }

    /**
     * Creates an exception for a file saving error.
     *
     * @param filePath the file path that failed to save
     * @param cause the underlying cause
     * @return a new ConfigurationException
     */
    public static ConfigurationException saveError(String filePath, Throwable cause) {
        return new ConfigurationException("Failed to save configuration to: " + filePath, cause);
    }

    /**
     * Creates an exception for an unsupported format.
     *
     * @param format the unsupported format
     * @return a new ConfigurationException
     */
    public static ConfigurationException unsupportedFormat(String format) {
        return new ConfigurationException("Unsupported configuration format: " + format);
    }
}
