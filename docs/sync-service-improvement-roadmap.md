# Sync Service Improvement Roadmap

## Purpose

This document captures the next improvement phase for `sync-service` after the package-map and canonical-ownership refactor.

The service no longer needs a large structural rewrite. The next step is to keep the current architecture healthy and prevent drift.

The roadmap focuses on:

- architecture governance
- clearer central-side grouping
- structural tests that protect the new design
- a consistent policy for future technical adapters

Current implementation note:

- central-side grouped use-cases now exist under `central.ingest`, `central.feed`, `central.outbox`, and `central.node`
- the HTTP sync adapter now lives under `transport.http`

## 1. Architecture Review Checklist

Use this checklist for any PR that changes `sync-service`.

### Boundary checks

- HTTP controllers stay in `api` and delegate immediately.
- Central runtime entry points stay in `central`.
- Edge runtime entry points stay in `edge`.
- Multi-step sync flow stays in `orchestration`.

### State and apply checks

- DB access, offsets, outbox, inbox, ack, sync logs, and conflicts stay in `state`.
- Generic apply logic stays in `apply`.
- Aggregate-specific apply logic stays in `apply.handlers`.

### Tier and shared checks

- Tier-specific behavior stays in `tier`.
- Cross-cutting sync concepts only go into `shared` if they are truly shared across multiple layers.

### Application package checks

- `application` is allowed only for bootstrap/runtime/configuration glue or central use-case services that do not yet justify a narrower package.
- A new class should not go into `application` by default.

## 2. Red Flags For PR Review

Reject or challenge a change when it does any of the following without a strong reason:

- adds a new repository or stateful DB access class outside `state`
- adds a new apply handler outside `apply.handlers`
- puts orchestration logic in a controller, facade, or scheduler
- adds a generic service into `application` when a specific package already exists
- places technical helpers into `shared` just because ownership is unclear
- reintroduces `infrastructure` as a catch-all bucket for business logic

## 3. Target Grouping For Central-Side Use Cases

The current central runtime is stable, but `application` still carries several central services and can drift into a broad service bucket over time.

### Recommended central use-case groups

#### Ingest group

Classes concerned with accepting and validating upstream sync input from edge/store nodes.

Current likely members:

- `SyncUploadService`
- `SyncNodeAuthService`
- `SyncInboxService`

#### Feed group

Classes concerned with producing central download feeds for stores/edge nodes.

Current likely members:

- `SyncDownloadService`
- `SyncStatusService`

#### Outbox group

Classes concerned with central outbox publishing and central event preparation.

Current likely members:

- `SyncOutboxService`

#### Node lifecycle group

Classes concerned with provisioning, rotating, revoking, and handshaking sync nodes.

Current likely members:

- `SyncNodeProvisioningService`

### Near-term recommendation

Do not move the underlying `application` services immediately unless the central side grows again.

Instead:

- keep `CentralSyncFacade` as the stable central boundary
- let grouped entry classes in `central.*` express the target shape
- use those groups as the target shape for future refactors

This avoids a large churn now while still preventing `application` from becoming an unstructured bucket.

## 4. Structural Test Plan

The current tests already protect major flow behavior. The next step is to protect the architectural contracts that are most likely to drift.

### Tier policy tests

Add focused tests for:

- which aggregates are allowed to push upstream by tier
- which aggregates are allowed to pull downstream by tier
- disabled upstream/downstream behavior by tier profile

Suggested scope:

- unit tests around `SyncTierProfileRegistry`
- focused tests per tier profile class

### Apply router tests

Add focused tests for:

- handler resolution by aggregate/event pair
- missing-handler conflict path
- apply-failed conflict path
- conflict policy gate before handler execution

Suggested scope:

- `SyncPayloadRouter`
- `SyncConflictPolicy`

### State transition tests

Add focused tests for:

- pending outbox claim behavior
- failed outbox retry window updates
- sync offset read/save behavior
- sync log open/finish semantics

Suggested scope:

- `SyncRepository`
- `DatabaseSyncStateStore`

### Guideline

Prefer focused structural tests over large end-to-end additions.

The goal is to protect:

- tier behavior
- apply behavior
- state transitions

without making the suite noisy or fragile.

## 5. Technical Adapter Placement Policy

At this point, `infrastructure` is effectively reserved for concrete technical adapters only.

### Recommended rule

If a new class is:

- a transport contract -> `transport`
- a persistence/state concern -> `state`
- an apply concern -> `apply` or `apply.handlers`
- a runtime boundary facade -> `central` or `edge`

then it must not go into `infrastructure`.

### What may still go into `infrastructure`

Very little.

Current example:

- none inside `sync-service` after moving the HTTP sync adapter to `transport.http`

### Future naming decision

If more technical adapters appear, choose one of two paths and keep it consistent:

- prefer adapter-domain packages such as `transport.http`
- only keep `infrastructure` if a future adapter truly has no clearer technical home

Do not let `infrastructure` become the default place for “miscellaneous” code or generic technical leftovers.

## 6. Priority Order

1. Apply the architecture review checklist in PR review.
2. Treat the central-side grouping as the target mental model for future changes.
3. Add focused structural tests in the next testing pass.
4. Decide adapter naming policy only when adapter growth actually starts.

## Summary

The architecture is already in a good place structurally.

The next phase is not a large refactor. It is governed evolution:

- keep package ownership stable
- prevent `application` drift
- protect tier/apply/state contracts with focused tests
- keep technical adapters from reintroducing a vague infrastructure bucket
