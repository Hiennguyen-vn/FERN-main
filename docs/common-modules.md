# Common Modules Guide

## Overview

The `common/` directory is now the main shared-library layer for the backend. It contains four Maven modules with a clear dependency order:

```text
common-utils
|-- common-model
|-- idempotency-core
`-- service-common
```

## Module Summary

### `common-utils`

Purpose:

- foundational utility layer
- no dependency on other internal modules

Main areas:

- configuration parsing and loading
- custom logging abstractions
- service and registry helper models
- cryptographic and token helpers
- ID generation
- scheduling and timing utilities

Code size:

- 49 main classes
- 18 test classes

Primary packages:

- `com.natsu.common.utils.config`
- `com.natsu.common.utils.log`
- `com.natsu.common.utils.registry`
- `com.natsu.common.utils.security`
- `com.natsu.common.utils.services`

### `common-model`

Purpose:

- abstract backend models for stateful infrastructure concerns

Main areas:

- cache abstractions and implementations
- query translation and datastore models
- SQL and NoSQL database abstractions
- message queue abstractions

Code size:

- 79 main classes
- 16 test classes

Primary packages:

- `com.natsu.common.model.cache`
- `com.natsu.common.model.core.datastore`
- `com.natsu.common.model.database`
- `com.natsu.common.model.message`

### `idempotency-core`

Purpose:

- reusable idempotency enforcement component

Main areas:

- Redis L1 duplicate suppression
- PostgreSQL L2 durable idempotency checks
- request hash conflict detection
- response replay support

Code size:

- 5 main classes

Primary packages:

- `com.dorabets.idempotency`
- `com.dorabets.idempotency.model`

### `service-common`

Purpose:

- reusable service runtime helpers for backend services

Main areas:

- Javalin-based service harness
- auth context and middleware
- environment-driven service config
- health endpoint registration
- correlation and error middleware
- repository base helpers
- field encryption support

Code size:

- 18 main classes
- 7 test classes

Primary packages:

- `com.dorabets.common.auth`
- `com.dorabets.common.config`
- `com.dorabets.common.event`
- `com.dorabets.common.health`
- `com.dorabets.common.middleware`
- `com.dorabets.common.repository`
- `com.dorabets.common.security`
- `com.dorabets.common.server`

## Dependency Notes

### Why `service-common` uses Javalin in a Spring repository

The current executable services use Spring Boot, but the imported shared service harness was originally built around Javalin. It is preserved as a reusable library because:

- it may still be useful for lightweight services or utilities
- the code is self-contained and well-tested
- removing it would lose working shared behavior

Treat it as an optional service foundation, not as a requirement for every Spring service.

### Why package names differ from Maven coordinates

The imported code keeps its original package names so the source stays stable and tests remain meaningful. The Maven coordinates were normalized to this repository:

- code packages: `com.natsu`, `com.dorabets`
- Maven group: `com.fern`

## Recommended Starting Points

If you are new to the imported code, start here:

- `common/common-utils/src/main/java/com/natsu/common/utils/config/Configuration.java`
- `common/common-utils/src/main/java/com/natsu/common/utils/services/ServicesRegistry.java`
- `common/common-model/src/main/java/com/natsu/common/model/cache/CacheManager.java`
- `common/common-model/src/main/java/com/natsu/common/model/database/DatabaseFactory.java`
- `common/common-model/src/main/java/com/natsu/common/model/message/MessageQueueFactory.java`
- `common/idempotency-core/src/main/java/com/dorabets/idempotency/IdempotencyGuard.java`
- `common/service-common/src/main/java/com/dorabets/common/server/ServiceApp.java`
- `common/service-common/src/main/java/com/dorabets/common/config/ServiceConfig.java`

## Existing Embedded Docs

The imported source already contained some focused docs that are still valuable:

- `common/common-utils/CONFIGURATION_GUIDE.md`
- `common/common-model/src/main/java/com/natsu/common/model/cache/README.md`
- `common/common-model/src/main/java/com/natsu/common/model/database/README.md`
- `common/common-model/src/main/java/com/natsu/common/model/message/README.md`
