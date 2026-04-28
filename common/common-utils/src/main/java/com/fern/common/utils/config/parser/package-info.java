/**
 * Configuration parsers for different file formats.
 *
 * <p>This package provides parsers for:</p>
 * <ul>
 *   <li>{@link com.fern.common.utils.config.parser.YamlConfigParser} - YAML format using SnakeYAML</li>
 *   <li>{@link com.fern.common.utils.config.parser.JsonConfigParser} - JSON format using Jackson</li>
 *   <li>{@link com.fern.common.utils.config.parser.TomlConfigParser} - TOML format using toml4j</li>
 * </ul>
 *
 * <p>Use {@link com.fern.common.utils.config.parser.ConfigParserFactory} to get parser instances:</p>
 * <pre>{@code
 * ConfigParser yamlParser = ConfigParserFactory.yaml();
 * ConfigParser jsonParser = ConfigParserFactory.json();
 * ConfigParser tomlParser = ConfigParserFactory.toml();
 *
 * // Auto-detect from file extension
 * ConfigParser parser = ConfigParserFactory.getParserForFile("config.yml");
 * }</pre>
 *
 * @see com.fern.common.utils.config.parser.ConfigParser
 * @see com.fern.common.utils.config.parser.ConfigParserFactory
 */
package com.fern.common.utils.config.parser;
