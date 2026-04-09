# Design assumptions

## 2026-04-03: Stitch-only design source
- The original local `FERN.fig` archive is no longer present in the workspace.
- The rebuild uses Stitch project `projects/5101169010042031961` and design system `assets/be935798a6dd445bb5549481a0dc02c5` as the only design truth.

## 2026-04-03: image-light backoffice
- Stitch screens are highly tonal and structured, but the strongest product value is in spacing, typography, sectioning, and surface hierarchy rather than decorative imagery.
- Dense admin modules stay image-light even though the original plan allowed editorial imagery on public/login surfaces.

## 2026-04-03: honest capability boundaries
- Where the backend contract is read-only or partial, the rebuilt UI exposes read/detail or the exact supported action only.
- No mutation surface is added without a confirmed controller contract or request DTO.

## 2026-04-06: remaining intentional boundaries
- CRM, Scheduling, and Workforce remain explicit unsupported/live-boundary modules until dedicated gateway contracts are exposed.
- Reports and Audit remain read-only surfaces by design.
- Inventory stock-balance rows remain read-only; no direct balance-edit controls are allowed.
- Public table ordering remains payment-free on customer routes; payment is still a staff-side workflow.
