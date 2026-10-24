$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateDir = Join-Path $repo '.local'
$logsDir = Join-Path $stateDir 'logs'
$runtimeFile = Join-Path $stateDir 'runtime.json'

if (Test-Path -LiteralPath $runtimeFile) {
  $old = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  $oldApi = Get-CimInstance Win32_Process -Filter "ProcessId = $($old.api_pid)" -ErrorAction SilentlyContinue
  $oldUi = Get-CimInstance Win32_Process -Filter "ProcessId = $($old.ui_pid)" -ErrorAction SilentlyContinue
  if ($oldApi.CommandLine -like '*src/server.js*' -and $oldUi.CommandLine -like '*vite.js*') {
    Write-Host 'OmegaTrack ja esta iniciado: http://localhost:5173'
    exit 0
  }
}

& (Join-Path $PSScriptRoot 'setup-local.ps1')
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Preparacao local falhou.' }

foreach ($port in 3000, 5173) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Porta $port ja esta em uso. Nenhum processo foi iniciado."
  }
}

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$node = (Get-Command node.exe).Source
$api = Start-Process -FilePath $node -ArgumentList @('src/server.js') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir 'api.out.log') -RedirectStandardError (Join-Path $logsDir 'api.err.log')
$ui = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort') -WorkingDirectory (Join-Path $repo 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir 'ui.out.log') -RedirectStandardError (Join-Path $logsDir 'ui.err.log')

@{ api_pid = $api.Id; ui_pid = $ui.Id } | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding UTF8

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $apiResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 2
    $uiResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
    if ($apiResponse.StatusCode -eq 200 -and $uiResponse.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}

if (-not $ready) {
  throw "Servidor nao respondeu a tempo. Verifique os logs em $logsDir"
}

Write-Host 'OmegaTrack iniciado.'
Write-Host 'Interface: http://localhost:5173'
Write-Host 'API:       http://localhost:3000/api/health'
Write-Host "Logs:      $logsDir"
Write-Host 'Parar:     npm run local:stop'
