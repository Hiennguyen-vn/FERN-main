# Common Module Overview

The `common/` directory contains the reusable backend code shared across services.

## Modules

- `common-utils`
  - foundational utility layer
- `common-model`
  - cache, database, datastore, and messaging abstractions
- `idempotency-core`
  - Redis and PostgreSQL based idempotency support
- `service-common`
  - service harness, auth, repository, health, and middleware helpers

## Dependency Graph

```text
common-utils
|-- common-model
|-- idempotency-core
`-- service-common
```

## Namespace Note

The imported source keeps its original package roots:

- `com.natsu.*`
- `com.dorabets.*`

The Maven coordinates are now managed as `com.fern:*`.

## Where To Start

- Utilities and shared configuration:
  - `common-utils/README.md`
- Data, cache, and messaging abstractions:
  - `common-model/README.md`
- Idempotency flow:
  - `idempotency-core/README.md`
- Service runtime support:
  - `service-common/README.md`
