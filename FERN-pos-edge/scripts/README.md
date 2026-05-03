# Scripts

## `generate-types.sh`

Pulls OpenAPI specs from the FERN backend gateway (`/api/v1/<service>/v3/api-docs`) and regenerates TypeScript types for both the PWA (`src/api/types.generated.ts`) and the agent upstream client (`agent/src/upstream/types.generated.ts`).

Usage:

```bash
FERN_GATEWAY_URL=http://localhost:8080 ./scripts/generate-types.sh
```

Requires Node 20 and `npx`. Specs cached under `contracts/*.openapi.json`; commit both specs and generated types.

## `install-windows.ps1`

Installs the Node agent as a Windows service via NSSM, enables the local Postgres service, and schedules a daily `pg_dump` backup. Run as Administrator from an elevated PowerShell:

```powershell
.\scripts\install-windows.ps1 `
  -InstallDir "C:\pos-edge" `
  -FernGatewayUrl "https://central.fern.vn" `
  -OutletId 42
```

Prerequisites:

- Node 20 LTS at `C:\Program Files\nodejs\node.exe`.
- NSSM at `C:\nssm\win64\nssm.exe` (download from https://nssm.cc/download).
- Postgres 16 installed, `pos_edge` database + `pos` role created.
- Repo copied to `C:\pos-edge\`.
