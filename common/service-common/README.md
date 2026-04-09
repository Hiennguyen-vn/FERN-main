# Service Common

This module provides reusable service runtime support for backend services.

## Main Areas

### Service Bootstrap

Package:

- `com.dorabets.common.server`

Key type:

- `ServiceApp`

What it does:

- creates a Javalin server
- initializes datasource, Redis, Kafka, and idempotency support
- registers health routes and middleware
- gives services one place to extend startup behavior

### Configuration

Package:

- `com.dorabets.common.config`

Key types:

- `ServiceConfig`
- `RuntimeEnvironment`

What it does:

- loads environment-driven service runtime settings
- controls development-mode gating for sensitive functionality

### Authentication And Middleware

Packages:

- `com.dorabets.common.auth`
- `com.dorabets.common.middleware`

Key types:

- `AuthContext`
- `AuthMiddleware`
- `InternalServiceAuth`
- `ErrorHandler`
- `CorrelationMiddleware`

What it does:

- bearer token extraction and verification hooks
- internal service auth helpers
- correlation ID propagation
- consistent error serialization

### Health And Repository Support

Packages:

- `com.dorabets.common.health`
- `com.dorabets.common.repository`

Key types:

- `HealthController`
- `BaseRepository`
- `SchemaSupport`

What it does:

- health endpoint registration
- basic JDBC query helpers
- transactional repository helper methods
- lightweight schema safety support

### Security

Package:

- `com.dorabets.common.security`

Key type:

- `FieldEncryption`

What it does:

- encrypts sensitive persisted fields with symmetric crypto helpers

## Important Note

This module is preserved from the imported shared-library set and uses Javalin internally. It remains useful for lightweight services and shared HTTP behavior even though the current executable services in this repository use Spring Boot.

## Test Coverage

This module currently includes tests for:

- auth context behavior
- internal auth helpers
- middleware path handling
- runtime environment mode detection
- field encryption
- repository-level repository-structure regression checks for this repository
