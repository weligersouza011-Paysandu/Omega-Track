param([switch]$SkipDependencies)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateDir = Join-Path $repo '.local'
$dataDir = Join-Path $stateDir 'postgres-data'
$passwordFile = Join-Path $stateDir 'postgres-password'
$envFile = Join-Path $repo '.env'
$pgBin = Join-Path $env:ProgramFiles 'PostgreSQL\18\bin'
$dbPort = 55432
$databaseUrlLine = if (Test-Path -LiteralPath $envFile) {
  Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
}
$standardMode = $databaseUrlLine -match '^DATABASE_URL=postgresql://[^@]+@127\.0\.0\.1:5432/omegatrack_dev\?schema=public$'

function New-HexSecret([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Invoke-Pg([string]$name, [string[]]$arguments) {
  & (Join-Path $pgBin $name) @arguments
  if ($LASTEXITCODE -ne 0) { throw "$name falhou (codigo $LASTEXITCODE)." }
}

if (-not $standardMode -and -not (Test-Path (Join-Path $pgBin 'initdb.exe'))) {
  throw 'PostgreSQL 18 nao encontrado em Program Files. Instale-o antes de continuar.'
}

if (-not $standardMode) {
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

if (Test-Path -LiteralPath $envFile) {
  $match = Select-String -LiteralPath $envFile -Pattern '^DATABASE_URL=postgresql://omegatrack:([0-9a-f]+)@127\.0\.0\.1:55432/omegatrack_dev\?schema=public$' | Select-Object -First 1
  if (-not $match) {
    throw '.env existente nao aponta para o banco local isolado. Nenhuma migracao foi aplicada.'
  }
  $password = $match.Matches[0].Groups[1].Value
  if (-not (Test-Path -LiteralPath $dataDir)) { throw 'Banco local ausente; .env existente foi preservado.' }
} else {
  if (Test-Path -LiteralPath $dataDir) { throw 'Banco local existente sem .env; interrompido para preservar os dados.' }
  $password = New-HexSecret 24
  [IO.File]::WriteAllText($passwordFile, $password, [Text.UTF8Encoding]::new($false))
  Invoke-Pg 'initdb.exe' @('-D', $dataDir, '-U', 'omegatrack', '-A', 'scram-sha-256', "--pwfile=$passwordFile", '-E', 'UTF8')

  $apiKey = New-HexSecret 32
  $jwtSecret = New-HexSecret 48
  $envLines = @(
    'NODE_ENV=development',
    'PORT=3000',
    'HOST=127.0.0.1',
    "DATABASE_URL=postgresql://omegatrack:$password@127.0.0.1:$dbPort/omegatrack_dev?schema=public",
    "API_KEY=$apiKey",
    "LOGIN_JWT_SECRET=$jwtSecret",
    'CORS_ORIGIN=http://localhost:5173',
    'CLOUDINARY_CLOUD_NAME=',
    'CLOUDINARY_API_KEY=',
    'CLOUDINARY_API_SECRET='
  )
  [IO.File]::WriteAllLines($envFile, $envLines, [Text.UTF8Encoding]::new($false))
  Write-Host 'Arquivo .env local criado (ignorado pelo Git).'
}

& (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir status *> $null
if ($LASTEXITCODE -ne 0) {
  $logFile = Join-Path $stateDir 'postgres.log'
  Invoke-Pg 'pg_ctl.exe' @('-D', $dataDir, '-l', $logFile, '-o', "-p $dbPort -h 127.0.0.1", 'start')
}

$env:PGPASSWORD = $password
try {
  $found = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $dbPort -U omegatrack -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'omegatrack_dev'"
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel consultar o PostgreSQL local.' }
  if (-not $found) {
    Invoke-Pg 'createdb.exe' @('-h', '127.0.0.1', '-p', "$dbPort", '-U', 'omegatrack', 'omegatrack_dev')
  }
} finally {
  $env:PGPASSWORD = $null
}
}

Push-Location $repo
try {
  if (-not $SkipDependencies) {
    if (-not (Test-Path 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci da API falhou.' } }
    if (-not (Test-Path 'frontend/node_modules')) { & npm.cmd --prefix frontend ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci do frontend falhou.' } }
  }
  $clientFile = Join-Path $repo 'node_modules\.prisma\client\index.js'
  $schemaFile = Join-Path $repo 'prisma\schema.prisma'
  if (-not (Test-Path -LiteralPath $clientFile) -or
      (Get-Item -LiteralPath $schemaFile).LastWriteTimeUtc -gt (Get-Item -LiteralPath $clientFile).LastWriteTimeUtc) {
    & npm.cmd run prisma:generate
    if ($LASTEXITCODE -ne 0) { throw 'Geracao do Prisma Client falhou.' }
  }
  & npm.cmd run prisma:deploy
  if ($LASTEXITCODE -ne 0) { throw 'Migracoes locais falharam.' }
} finally {
  Pop-Location
}

if ($standardMode) {
  Write-Host 'Ambiente local pronto. Banco: 127.0.0.1:5432/omegatrack_dev.'
} else {
  Write-Host 'Ambiente local pronto. Banco: 127.0.0.1:55432/omegatrack_dev.'
}
