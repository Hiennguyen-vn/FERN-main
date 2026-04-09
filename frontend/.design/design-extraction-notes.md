# Stitch extraction notes

Primary design source:
- Stitch project: `projects/5101169010042031961`
- Stitch design system: `assets/be935798a6dd445bb5549481a0dc02c5`

Checked on 2026-04-03.

## Theme signals pulled from Stitch
- Display/headline font: `Manrope`
- Body/labels: `Inter`
- Base background: `#f7f9fb`
- Mid layer: `#f2f4f6`
- Top cards: `#ffffff`
- Primary: `#27389a`
- Primary gradient companion: `#4151b3`
- Tertiary success: `#004e33`
- Roundness: `ROUND_FOUR`

## Design language
- Light architectural ERP workspace with tonal layering instead of hard borders
- Left rail plus expansive content stage
- Primary summary surfaces use glass-like elevated cards and indigo gradient CTAs
- Dense tables and operational forms remain data-first and avoid decorative clutter
- POS uses softer, larger targets than backoffice
- Public ordering keeps the same palette but with a lighter, more welcoming shell

## Stitch screen clusters used for implementation
- Login and shell:
  - `Login - Normal State`
  - `Action Hub - Outlet Manager View`
  - `Regional Sales Dashboard`
- Access / IAM:
  - `System Permissions & Scopes`
  - `Create User Wizard - Step 1: Identity`
  - `Create User Wizard - Step 2: Linkage Conflict`
  - `User Detail - HR (System Scope)`
- Catalog and product:
  - `Product Detail - Read-only Mode`
  - `Create Product - Draft State`
  - `Recipe Master Catalog - Detailed List`
- Inventory:
  - `Inventory & Stock Moves`
  - `Stock Count - Draft / Review`
  - `Stock Count - Posted (Read-only)`
- Procurement:
  - `Vendor Approval Detail`
  - `PO Approval - Submitted (Regional Finance)`
  - `GR Detail - Posted (Read-only)`
  - `GR Detail - Cancelled (Read-only)`
- HR and payroll:
  - `Attendance Review - Pending Queue`
  - `Payroll Approval Workspace - Detailed Review`
  - `Payment Run Detail - Processing`
- POS and public ordering:
  - `POS Session - Active Overview`
  - `POS Payment - Open & Insufficient`

## Important limits
- Stitch is now the only surviving design source in the repo.
- The local `FERN.fig` fallback referenced in older notes has been deleted with the old frontend workspace.
- Implementation should use Stitch screens and theme values directly, then log conservative inferences in `design-assumptions.md`.

## Backend-boundary alignment (2026-04-06)
- Reports and Audit stay data-dense and read-only in layout and copy.
- Inventory balance surfaces preserve inspection-first UX; no direct edit affordances.
- Public ordering remains payment-free on customer routes and references staff-side settlement.
- CRM/Scheduling/Workforce remain explicit unsupported modules in the shell, rather than mock-complete screens.
