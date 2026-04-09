# Common Model

This module contains shared abstractions for stateful backend concerns.

## Main Areas

### Cache

Package:

- `com.natsu.common.model.cache`

Responsibilities:

- in-memory cache implementation
- Redis-backed cache abstraction
- tiered cache support
- cache statistics and cache manager support
- annotation-based cache metadata

Good entry points:

- `Cache`
- `CacheManager`
- `CacheConfig`
- `InMemoryCache`
- `TieredCache`

### Datastore Translation

Package:

- `com.natsu.common.model.core.datastore`

Responsibilities:

- query intermediate representation
- translation helpers for SQL and Mongo-like backends
- capability flags and adapter registration

Good entry points:

- `QueryIR`
- `FilterNode`
- `SqlTranslator`
- `MongoTranslator`
- `UnifiedDataStore`

### Database

Package:

- `com.natsu.common.model.database`

Responsibilities:

- shared SQL and NoSQL database contracts
- configuration and factory patterns
- SQL connection and result helpers
- test-friendly in-memory database support

Good entry points:

- `DatabaseConfig`
- `DatabaseFactory`
- `SqlDatabase`
- `NoSqlDatabase`

### Messaging

Package:

- `com.natsu.common.model.message`

Responsibilities:

- message queue abstraction
- local queue implementation
- socket, Redis, and RabbitMQ oriented abstractions
- serializer and request-reply support

Good entry points:

- `MessageQueue`
- `MessageQueueFactory`
- `Message`
- `LocalMessageQueue`

## Existing Source Docs

The module already contains detailed package readmes in:

- `src/main/java/com/natsu/common/model/cache/README.md`
- `src/main/java/com/natsu/common/model/database/README.md`
- `src/main/java/com/natsu/common/model/message/README.md`

Read those next if you are implementing against one of these subsystems.
