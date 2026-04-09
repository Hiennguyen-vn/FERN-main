@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%"

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
)

docker compose --env-file .env up -d postgres postgres-replica redis kafka prometheus grafana
echo FERN local dependencies are starting.

popd
endlocal
