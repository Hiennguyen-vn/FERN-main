# FERN POS Edge — Windows service installer
# Installs the Node agent + local Postgres as Windows services via NSSM.
# Run as Administrator.

#Requires -RunAsAdministrator

param(
  [string]$InstallDir = "C:\pos-edge",
  [string]$NodeExe    = "C:\Program Files\nodejs\node.exe",
  [string]$NssmExe    = "C:\nssm\win64\nssm.exe",
  [string]$FernGatewayUrl = "http://fern-central.local:8080",
  [int]   $OutletId   = 1,
  [string]$LocalDbUrl = "postgresql://pos:pos_dev@localhost:5434/pos_edge"
)

$ErrorActionPreference = "Stop"

Write-Host "== FERN POS Edge installer ==" -ForegroundColor Cyan

# Sanity checks
if (-not (Test-Path $NodeExe)) { throw "Node not found at $NodeExe — install Node 20 LTS first" }
if (-not (Test-Path $NssmExe)) { throw "NSSM not found at $NssmExe — download from https://nssm.cc/download" }
if (-not (Test-Path $InstallDir)) { throw "Install dir $InstallDir does not exist — copy the repo there first" }

$agentDir = Join-Path $InstallDir "agent"
$agentMain = Join-Path $agentDir "dist\index.js"

if (-not (Test-Path $agentMain)) {
  Write-Host "Building agent…"
  Push-Location $agentDir
  & npm install --omit=dev
  & npm run build
  Pop-Location
}

# Install Postgres as service via stock installer (skipped here — assume already installed).
# Start + enable Postgres service.
$pgService = Get-Service -Name "postgresql-x64-16" -ErrorAction SilentlyContinue
if ($pgService) {
  Set-Service -Name "postgresql-x64-16" -StartupType Automatic
  Start-Service -Name "postgresql-x64-16"
  Write-Host "Postgres service started."
} else {
  Write-Host "Postgres service not detected — install Postgres 16 first." -ForegroundColor Yellow
}

# Install agent service via NSSM
$serviceName = "FernPosAgent"
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Removing existing $serviceName…"
  & $NssmExe stop $serviceName
  & $NssmExe remove $serviceName confirm
}

Write-Host "Installing $serviceName…"
& $NssmExe install $serviceName $NodeExe $agentMain
& $NssmExe set $serviceName AppDirectory $agentDir
& $NssmExe set $serviceName AppEnvironmentExtra `
  "LOCAL_DB_URL=$LocalDbUrl" `
  "FERN_GATEWAY_URL=$FernGatewayUrl" `
  "OUTLET_ID=$OutletId" `
  "AGENT_PORT=8099" `
  "LOG_LEVEL=info" `
  "NODE_ENV=production"
& $NssmExe set $serviceName Start SERVICE_AUTO_START
& $NssmExe set $serviceName AppStdout "$InstallDir\logs\agent.out.log"
& $NssmExe set $serviceName AppStderr "$InstallDir\logs\agent.err.log"
& $NssmExe set $serviceName AppRotateFiles 1
& $NssmExe set $serviceName AppRotateBytes 10485760  # 10 MB

New-Item -ItemType Directory -Path "$InstallDir\logs" -Force | Out-Null

Write-Host "Starting $serviceName…"
& $NssmExe start $serviceName

Start-Sleep -Seconds 3
try {
  $health = Invoke-RestMethod -Uri "http://localhost:8099/health" -TimeoutSec 5
  Write-Host "Agent healthy: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
  Write-Host "Agent health check failed — inspect $InstallDir\logs\agent.err.log" -ForegroundColor Red
}

# Schedule daily pg_dump backup
$backupDir = "D:\backups\pos-edge"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$taskName = "FernPosEdgeBackup"
$pgDump = "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
if (Test-Path $pgDump) {
  $action = New-ScheduledTaskAction -Execute $pgDump `
    -Argument "-U pos -d pos_edge -f `"$backupDir\pos_edge_$(Get-Date -Format yyyyMMdd_HHmm).sql`""
  $trigger = New-ScheduledTaskTrigger -Daily -At 2am
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force | Out-Null
  Write-Host "Scheduled daily backup task '$taskName' at 02:00." -ForegroundColor Green
}

Write-Host "== Done ==" -ForegroundColor Cyan
Write-Host "Agent: http://localhost:8099"
Write-Host "PWA should point to the above URL."
