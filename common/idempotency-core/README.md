# Idempotency Core

This module contains a reusable idempotency guard designed around two storage layers.

## Core Concept

`IdempotencyGuard` uses:

- Redis as L1 for fast duplicate detection
- PostgreSQL as L2 for durable replay-safe enforcement

## Main Flow

1. Hash the incoming request body.
2. Check Redis for a prior response.
3. If Redis misses, check PostgreSQL for the idempotency key.
4. Insert a `started` row when handling begins.
5. Execute the business handler once.
6. Persist the final result in PostgreSQL.
7. Cache the replay result in Redis.

## Main Types

- `IdempotencyGuard`
- `IdempotencyException`
- `IdempotencyConflictException`
- `IdempotencyResult`
- `TtlPolicy`

## When To Use It

Use this module when an operation must not create duplicate effects, for example:

- wallet credits
- payment captures
- webhook processing
- external callback retries

## Adoption Notes

- Redis failure is treated as a non-fatal degradation path.
- PostgreSQL is the durable source of truth.
- request hash mismatches are treated as idempotency-key conflicts.
- this module is infrastructure-oriented and does not define HTTP behavior itself.
