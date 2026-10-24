param([switch]$KeepDatabase)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeFile = Join-Path $repo '.local\runtime.json'
$dataDir = Join-Path $repo '.local\postgres-data'
$pgCtl = Join-Path $env:ProgramFiles 'PostgreSQL\18\bin\pg_ctl.exe'

if (Test-Path -LiteralPath $runtimeFile) {
  $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  $processes = @(
    @{ pid = $runtime.api_pid; marker = 'src/server.js' },
    @{ pid = $runtime.ui_pid; marker = 'vite.js' }
  )
  foreach ($entry in $processes) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)" -ErrorAction SilentlyContinue
    if ($process.Name -eq 'node.exe' -and $process.CommandLine -like "*$($entry.marker)*") {
      Stop-Process -Id $entry.pid
    }
  }
  Remove-Item -LiteralPath $runtimeFile
}

if (-not $KeepDatabase -and (Test-Path -LiteralPath $dataDir) -and (Test-Path -LiteralPath $pgCtl)) {
  & $pgCtl -D $dataDir status *> $null
  if ($LASTEXITCODE -eq 0) {
    & $pgCtl -D $dataDir -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao parar o banco PostgreSQL local.' }
  }
}
if ($KeepDatabase) {
  Write-Host 'API e interface encerradas. Banco de origem mantido para migracao.'
} elseif ((Test-Path -LiteralPath (Join-Path $repo '.env')) -and
          ((Get-Content -LiteralPath (Join-Path $repo '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -match '@127\.0\.0\.1:5432/omegatrack_dev\?schema=public$')) {
  Write-Host 'API e interface encerradas. PostgreSQL padrao permanece ligado.'
} else {
  Write-Host 'API, interface e banco local encerrados. Os dados foram preservados.'
}
