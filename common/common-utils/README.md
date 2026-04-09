# Common Utils

This module is the bottom layer of the shared-library stack. Other shared modules depend on it.

## Main Areas

### Configuration

Packages:

- `com.natsu.common.utils.config`
- `com.natsu.common.utils.config.parser`

Responsibilities:

- YAML, JSON, and TOML loading
- path-based value access
- caching and change-listener support
- format-specific parser selection

Start with:

- `Configuration`
- `ConfigurationManager`
- `ConfigSection`
- `ConfigParserFactory`

Detailed guide:

- `CONFIGURATION_GUIDE.md`

### Logging

Packages:

- `com.natsu.common.utils.log`
- `com.natsu.common.utils.log.appender`

Responsibilities:

- custom logging abstraction
- formatting and event models
- console, file, and database appenders

Start with:

- `Logger`
- `LoggerFactory`
- `LogEvent`

### Registry And Service Metadata

Packages:

- `com.natsu.common.utils.registry`
- `com.natsu.common.utils.services`

Responsibilities:

- service registration models
- load balancing and routing strategy contracts
- service metadata and timing support
- scheduler and ID generator utilities

Start with:

- `ServicesRegistry`
- `ServiceDefinition`
- `SnowflakeIdGenerator`
- `TaskSchedulerImpl`
- `TimingServiceImpl`

### Security

Package:

- `com.natsu.common.utils.security`

Responsibilities:

- password hashing helpers
- token helpers
- opaque token encryption
- hashing utilities

Start with:

- `PasswordUtil`
- `TokenUtil`
- `OpaqueTokenCrypto`
- `HashUtil`
