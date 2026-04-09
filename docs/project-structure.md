# Project Structure

## Root Purpose

The repository is a Java-first ERP platform with a Maven backend reactor and an in-repo frontend workspace for gateway-based operations UI.

## Root Directories

### `.mvn/`

Stores Maven runtime settings.

- `.mvn/maven.config`
  - enables parallel build execution with `-T 1C`

### `common/`

Stores reusable backend libraries.

Current modules:

- `common-utils`
  - base utility layer
- `common-model`
  - shared abstractions for cache, data, and messaging
- `idempotency-core`
  - reusable idempotency guard
- `service-common`
  - reusable service harness and backend middleware layer

### `db/`

Stores non-code database assets.

- `docs/`
  - ERD notes and database decisions
- `migrations/`
  - schema migration placeholders
- `seeds/`
  - local seed placeholders

### `infra/`

Stores local backend dependency setup.

Current scope:

- PostgreSQL
- Redis
- Kafka
- Prometheus/Grafana
- env templates, shell launchers, workflow validation, and query/observability helpers

### `frontend/`

Stores the first real browser app for FERN.

Current stack:

- Vite
- React + TypeScript
- TanStack Router
- TanStack Query
- React Hook Form + Zod
- Tailwind CSS + design tokens
- Radix UI primitives
- Vitest + Playwright

### `docs/`

Stores backend, frontend, and integration documentation.

Frontend-facing documentation now lives here too:

- `frontend-startup.md`
  - single entrypoint for frontend developers starting the backend locally
- `frontend-readiness.md`
  - source-confirmed service-by-service frontend readiness and security notes
- `frontend-api-gap-analysis.md`
  - service-by-service matrix of missing APIs, current coverage, and next backend needs
- `openapi/frontend-surface.json`
  - current machine-readable gateway contract for frontend-critical routes

### `services/`

Stores executable services.

- `auth-service/`
  - nested multi-module service
- `master-node/`
  - standard Spring Boot service

## Reactor Ownership

The root `pom.xml` is the source of truth for:

- Maven module registration
- Java version
- dependency management
- plugin management

The `common/pom.xml` file is the source of truth for shared-library module registration.

The `services/pom.xml` file is the source of truth for service module registration.

## Imported Shared Library Provenance

The live `common/` directory was imported from `.archived/common`.

What was preserved:

- Java source code
- tests
- embedded package-level readmes
- the existing package structure

What was changed for active use:

- modules were registered in Maven instead of Gradle
- module POMs were created
- project documentation was added for the active repository
- an archive-specific regression test was rewritten to validate this repository instead

## Package Namespace Strategy

The repository currently contains mixed package roots because the shared libraries were imported rather than rewritten:

- `com.natsu` packages are concentrated in utility and model code
- `com.dorabets` packages are concentrated in idempotency and service support code
- `com.fern` is the Maven coordinate namespace

This is intentional. It keeps imported code stable while allowing repository ownership to remain consistent.
