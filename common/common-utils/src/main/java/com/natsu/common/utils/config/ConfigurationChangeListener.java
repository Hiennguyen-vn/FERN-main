package com.natsu.common.utils.config;

import java.nio.file.Path;

/**
 * Listener interface for configuration change events.
 */
@FunctionalInterface
public interface ConfigurationChangeListener {

    /**
     * Called when a configuration file has been modified.
     *
     * @param event the change event containing details about the change
     */
    void onConfigurationChanged(ConfigurationChangeEvent event);

    /**
     * Event data for configuration changes.
     */
    record ConfigurationChangeEvent(
            Path filePath,
            String configName,
            ConfigSection oldConfig,
            ConfigSection newConfig,
            ChangeType changeType
    ) {
        /**
         * Type of configuration change.
         */
        public enum ChangeType {
            CREATED,
            MODIFIED,
            DELETED
        }
    }
}
