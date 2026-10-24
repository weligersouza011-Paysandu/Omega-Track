$ErrorActionPreference = 'Stop'
$baseUrl = 'http://127.0.0.1:3000/api'

try {
  $health = Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 5
  if ($health.service -ne 'OmegaTrack API') { throw 'Servico inesperado na porta 3000.' }
  $response = Invoke-RestMethod -Uri "$baseUrl/usuarios?tipo=ADMINISTRADOR" -TimeoutSec 5
} catch {
  throw 'API OmegaTrack local indisponivel. Execute npm run local:start antes deste comando.'
}

if (@($response.data).Count -gt 0) {
  Write-Host 'Ja existe um administrador neste banco local. Entre pela interface com sua matricula e senha.'
  exit 0
}

$nome = (Read-Host 'Nome completo').Trim()
$matricula = (Read-Host 'Matricula').Trim()
if (-not $nome -or -not $matricula) { throw 'Nome e matricula sao obrigatorios.' }

$senhaSegura = Read-Host 'Senha (minimo de 8 caracteres)' -AsSecureString
$confirmacaoSegura = Read-Host 'Confirme a senha' -AsSecureString
$senhaPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSegura)
$confirmacaoPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmacaoSegura)
try {
  $senha = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($senhaPtr)
  $confirmacao = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmacaoPtr)
  if ($senha.Length -lt 8) { throw 'A senha deve ter pelo menos 8 caracteres.' }
  if ($senha -cne $confirmacao) { throw 'As senhas nao conferem.' }

  $body = @{ nome = $nome; matricula = $matricula; setor = 'GESTAO'; nivel = 'MASTER'; senha = $senha } | ConvertTo-Json
  $created = Invoke-RestMethod -Uri "$baseUrl/usuarios/admin" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
  Write-Host "Administrador local criado: $($created.data.nome) (matricula $($created.data.matricula))."
  Write-Host 'Abra http://localhost:5173 e faca login.'
} finally {
  if ($senhaPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($senhaPtr) }
  if ($confirmacaoPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmacaoPtr) }
  $senha = $null
  $confirmacao = $null
  $body = $null
}
