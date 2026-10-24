$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateDir = Join-Path $repo '.local'
$backupDir = Join-Path $stateDir 'backups'
$statusFile = Join-Path $stateDir 'migration-to-default-status.json'
$envFile = Join-Path $repo '.env'
$sourceDataDir = Join-Path $stateDir 'postgres-data'
$sourcePasswordFile = Join-Path $stateDir 'postgres-password'
$pgBin = Join-Path $env:ProgramFiles 'PostgreSQL\18\bin'
$psql = Join-Path $pgBin 'psql.exe'
$bstr = [IntPtr]::Zero
$targetPassword = $null
$sourcePassword = $null
$envBackup = $null
$appStopped = $false
$envSwitched = $false
$completed = $false

function Write-Status([string]$state, [string]$message) {
  @{ status = $state; message = $message; time = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
}

function Invoke-Psql([int]$port, [string]$user, [string]$database, [string]$password, [string]$sql) {
  $env:PGPASSWORD = $password
  try {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $result = & $psql -X -A -t -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U $user -d $database -c $sql 2>&1
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    if ($code -ne 0) {
      $detail = ($result | ForEach-Object { $_.ToString() }) -join ' '
      throw "Consulta PostgreSQL falhou na porta ${port}: $detail"
    }
    return $result
  } finally {
    $env:PGPASSWORD = $null
  }
}

function Get-Counts([int]$port, [string]$user, [string]$password) {
  $sql = "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename"
  $tables = @(Invoke-Psql $port $user 'omegatrack_dev' $password $sql)
  foreach ($table in $tables) {
    $quoted = '"' + $table.Replace('"', '""') + '"'
    $count = Invoke-Psql $port $user 'omegatrack_dev' $password "SELECT count(*) FROM public.$quoted"
    "$table=$count"
  }
}

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Write-Status 'running' 'Aguardando credenciais da conexao padrao.'

try {
  if (-not (Test-Path -LiteralPath $sourceDataDir) -or -not (Test-Path -LiteralPath $sourcePasswordFile)) {
    throw 'Banco de origem isolado nao encontrado.'
  }
  if (-not (Test-Path -LiteralPath $psql)) { throw 'PostgreSQL 18 nao encontrado em Program Files.' }
  $envLines = @(Get-Content -LiteralPath $envFile -Encoding UTF8)
  $databaseLines = @($envLines | Where-Object { $_ -match '^DATABASE_URL=' })
  if ($databaseLines.Count -ne 1 -or
      $databaseLines[0] -notmatch '^DATABASE_URL=postgresql://omegatrack:[^@]+@127\.0\.0\.1:55432/omegatrack_dev\?schema=public$') {
    throw 'O .env nao aponta exclusivamente para o banco isolado esperado. Migracao interrompida.'
  }

  $targetUser = 'postgres'
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $securePassword = Read-Host 'Senha PostgreSQL da conexao padrao' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $targetPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if (-not $targetPassword) { throw 'Senha vazia.' }
    Write-Host 'Validando acesso ao PostgreSQL padrao em 127.0.0.1:5432...'
    try {
      $connectedUser = Invoke-Psql 5432 $targetUser 'postgres' $targetPassword 'SELECT current_user'
      break
    } catch {
      if ($attempt -eq 3) { throw }
      Write-Host $_.Exception.Message -ForegroundColor Yellow
      $targetPassword = $null
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      $bstr = [IntPtr]::Zero
    }
  }
  Write-Host "Conectado como $connectedUser."
  $exists = Invoke-Psql 5432 $targetUser 'postgres' $targetPassword "SELECT 1 FROM pg_database WHERE datname = 'omegatrack_dev'"
  if ($exists -eq '1') {
    throw 'O banco omegatrack_dev ja existe na porta 5432. Nada foi sobrescrito.'
  }

  $sourcePassword = (Get-Content -LiteralPath $sourcePasswordFile -Raw).Trim()
  $sourceCheck = Invoke-Psql 55432 'omegatrack' 'omegatrack_dev' $sourcePassword 'SELECT current_database()'
  if ($sourceCheck -ne 'omegatrack_dev') { throw 'Banco de origem nao respondeu como esperado.' }

  Write-Status 'running' 'Credenciais validadas. Parando a aplicacao e gerando backup.'
  & (Join-Path $PSScriptRoot 'stop-local.ps1') -KeepDatabase
  $appStopped = $true

  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $dumpPath = Join-Path $backupDir "omegatrack_dev_final_$stamp.dump"
  $env:PGPASSWORD = $sourcePassword
  try {
    & (Join-Path $pgBin 'pg_dump.exe') -h 127.0.0.1 -p 55432 -U omegatrack -d omegatrack_dev -w -Fc --no-owner --no-acl -f $dumpPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar banco de origem.' }
  } finally { $env:PGPASSWORD = $null }
  & (Join-Path $pgBin 'pg_restore.exe') -l $dumpPath > $null
  if ($LASTEXITCODE -ne 0) { throw 'Backup exportado nao passou na verificacao.' }

  Write-Status 'running' 'Backup pronto. Criando e restaurando banco na porta 5432.'
  $env:PGPASSWORD = $targetPassword
  try {
    & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 5432 -U $targetUser -w -E UTF8 -T template0 omegatrack_dev
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar omegatrack_dev no PostgreSQL padrao.' }
    & (Join-Path $pgBin 'pg_restore.exe') -h 127.0.0.1 -p 5432 -U $targetUser -d omegatrack_dev -w --no-owner --no-acl --exit-on-error $dumpPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar o backup no PostgreSQL padrao.' }
  } finally { $env:PGPASSWORD = $null }

  $sourceCounts = @(Get-Counts 55432 'omegatrack' $sourcePassword)
  $targetCounts = @(Get-Counts 5432 $targetUser $targetPassword)
  if ($sourceCounts.Count -eq 0 -or (Compare-Object $sourceCounts $targetCounts)) {
    throw 'Contagens de tabelas diferentes entre origem e destino. O .env foi preservado.'
  }
  Write-Host "Contagens conferidas em $($sourceCounts.Count) tabelas."

  $envBackup = Join-Path $backupDir "env_before_default_$stamp.bak"
  Copy-Item -LiteralPath $envFile -Destination $envBackup
  $encodedUser = [uri]::EscapeDataString($targetUser)
  $encodedPassword = [uri]::EscapeDataString($targetPassword)
  $newUrl = "postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:5432/omegatrack_dev?schema=public"
  $updatedLines = @($envLines | ForEach-Object {
    if ($_ -match '^DATABASE_URL=') { "DATABASE_URL=$newUrl" } else { $_ }
  })
  [IO.File]::WriteAllLines($envFile, [string[]]$updatedLines, [Text.UTF8Encoding]::new($false))
  $envSwitched = $true

  Write-Status 'running' 'Dados conferidos. Iniciando aplicacao com o banco padrao.'
  Push-Location $repo
  try {
    & npm.cmd run local:start
    if ($LASTEXITCODE -ne 0) { throw 'Aplicacao nao iniciou com o banco padrao.' }
  } finally { Pop-Location }

  & (Join-Path $pgBin 'pg_ctl.exe') -D $sourceDataDir status *> $null
  if ($LASTEXITCODE -eq 0) {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $sourceDataDir -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Banco antigo continuou ligado; os dados e o backup permanecem intactos.' }
  }

  $completed = $true
  Write-Status 'complete' 'Banco migrado para 127.0.0.1:5432/omegatrack_dev; aplicacao iniciada.'
  Write-Host 'Migracao concluida. Atualize a conexao postgres no DBeaver.' -ForegroundColor Green
} catch {
  $message = $_.Exception.Message
  Write-Host "Migracao interrompida: $message" -ForegroundColor Red
  if ($appStopped) {
    if ($envSwitched) {
      try { & (Join-Path $PSScriptRoot 'stop-local.ps1') -KeepDatabase } catch { }
      if ($envBackup -and (Test-Path -LiteralPath $envBackup)) {
        Copy-Item -LiteralPath $envBackup -Destination $envFile -Force
      }
    }
    try {
      Push-Location $repo
      & npm.cmd run local:start
    } catch { } finally { Pop-Location }
  }
  Write-Status 'failed' $message
} finally {
  $env:PGPASSWORD = $null
  $targetPassword = $null
  $sourcePassword = $null
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not $completed) { exit 1 }
