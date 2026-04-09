# Documentation Index

This folder explains how the backend is structured, how the frontend integrates through the gateway, and how to build and test the repository safely.

## Start Here

- `frontend-startup.md`
  - single start-here guide for frontend developers running the gateway and `/frontend` workspace locally
- `frontend-readiness.md`
  - service-by-service source-confirmed frontend readiness, visibility, auth model, and confidence
- `frontend-api-gap-analysis.md`
  - service-by-service gap matrix covering docs, contract, frontend client/screen coverage, authz, and tests
- `openapi/frontend-surface.json`
  - machine-readable OpenAPI contract for the current frontend-facing gateway surface
- `project-structure.md`
  - root layout, ownership boundaries, and reactor structure
- `erp-microservices-architecture.md`
  - target-state ERP microservices architecture, gateway, control-plane, caching, Kafka, and rollout design
- `common-modules.md`
  - detailed guide to the imported common libraries
- `testing-and-running.md`
  - exact commands for infrastructure, tests, builds, and service startup
- `data-simulator.md`
  - internal simulator architecture, safety rules, parameters, preview/execute flow, and run commands
- `../infra/README.md`
  - local infra layout, lifecycle scripts, startup modes, and test routing modes

## Related Module Documentation

- `../common/README.md`
- `../common/common-model/README.md`
- `../common/common-utils/README.md`
- `../common/idempotency-core/README.md`
- `../common/service-common/README.md`
