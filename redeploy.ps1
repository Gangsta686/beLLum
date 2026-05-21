$ErrorActionPreference = "Stop"
$ProjectRef = "ekrxjbdkkkplxsnmmcgo"
$CliPath    = "$env:USERPROFILE\.supabase-cli"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (Test-Path "$CliPath\supabase.exe") {
    $env:Path = "$CliPath;" + $env:Path
}
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "Supabase CLI не найден. Перезапусти PowerShell." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Передеплой Edge Functions с исправленными импортами" -ForegroundColor Cyan
Write-Host ""

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Host "Открой https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
    Write-Host "Сгенерируй (или возьми существующий) токен sbp_..." -ForegroundColor Yellow
    Write-Host ""
    $sec = Read-Host -AsSecureString "Вставь токен (символы НЕ покажутся)"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
    if (-not $pat) { Write-Host "Токен пустой." -ForegroundColor Red; exit 1 }
    $env:SUPABASE_ACCESS_TOKEN = $pat.Trim()
}

Write-Host "Деплой create-invoice..." -ForegroundColor Gray
& supabase functions deploy create-invoice --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { Write-Host "create-invoice провален" -ForegroundColor Red; exit 1 }
Write-Host "  [OK] create-invoice" -ForegroundColor Green

Write-Host "Деплой payments-webhook..." -ForegroundColor Gray
& supabase functions deploy payments-webhook --no-verify-jwt --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { Write-Host "payments-webhook провален" -ForegroundColor Red; exit 1 }
Write-Host "  [OK] payments-webhook" -ForegroundColor Green

Write-Host ""
Write-Host "Жду 5 секунд и пингую функцию..." -ForegroundColor Gray
Start-Sleep -Seconds 5

$url = "https://$ProjectRef.supabase.co/functions/v1/payments-webhook/cryptocloud"
try {
    $r = Invoke-WebRequest -Uri $url -Method Post -Body '{"test":1}' -ContentType "application/json" -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
    Write-Host ("Пинг: status {0}, body: {1}" -f $r.StatusCode, $r.Content) -ForegroundColor Green
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $code = [int]$resp.StatusCode
        $body = ""
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $body = $_.ErrorDetails.Message }
        if ($code -eq 401 -or $code -eq 400 -or $code -eq 404) {
            Write-Host ("Пинг: status {0}, body: {1}" -f $code, $body) -ForegroundColor Green
            Write-Host "  Это нормально - функция жива и отвергла наш фейковый запрос." -ForegroundColor Green
        } else {
            Write-Host ("Пинг: status {0}, body: {1}" -f $code, $body) -ForegroundColor Yellow
        }
    } else {
        Write-Host ("Пинг упал: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Готово." -ForegroundColor Green
