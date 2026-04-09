package com.natsu.common.utils.config.parser;

import com.natsu.common.utils.config.ConfigFormat;
import com.natsu.common.utils.config.ConfigurationException;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.representer.Representer;

import java.io.Reader;
import java.io.Writer;
import java.util.Map;

/**
 * Configuration parser for YAML format using SnakeYAML.
 */
public class YamlConfigParser extends AbstractConfigParser {

    private final Yaml yaml;

    public YamlConfigParser() {
        super(ConfigFormat.YAML);
        this.yaml = createYaml();
    }

    private Yaml createYaml() {
        LoaderOptions loaderOptions = new LoaderOptions();
        loaderOptions.setAllowDuplicateKeys(false);
        loaderOptions.setMaxAliasesForCollections(50);

        DumperOptions dumperOptions = new DumperOptions();
        dumperOptions.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        dumperOptions.setPrettyFlow(true);
        dumperOptions.setIndent(2);
        dumperOptions.setIndicatorIndent(1); // Must be smaller than indent
        dumperOptions.setDefaultScalarStyle(DumperOptions.ScalarStyle.PLAIN);

        Representer representer = new Representer(dumperOptions);
        representer.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);

        return new Yaml(new SafeConstructor(loaderOptions), representer, dumperOptions, loaderOptions);
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> parse(Reader reader) {
        try {
            Object loaded = yaml.load(reader);
            if (loaded == null) {
                return createConfigMap();
            }
            if (loaded instanceof Map) {
                return (Map<String, Object>) loaded;
            }
            throw new ConfigurationException("YAML root must be a map/object, got: " + loaded.getClass().getSimpleName());
        } catch (Exception e) {
            if (e instanceof ConfigurationException) {
                throw e;
            }
            throw new ConfigurationException("Failed to parse YAML configuration", e);
        }
    }

    @Override
    public void write(Writer writer, Map<String, Object> data) {
        try {
            yaml.dump(ensureNonNull(data), writer);
        } catch (Exception e) {
            throw new ConfigurationException("Failed to write YAML configuration", e);
        }
    }
}
