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

function Read-Secret([string]$Prompt) {
    while ($true) {
        $sec = Read-Host -AsSecureString $Prompt
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        $val  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
        if ($val -and $val.Trim().Length -gt 0) { return $val.Trim() }
        Write-Host "  Поле обязательное." -ForegroundColor Yellow
    }
}
function Read-Required([string]$Prompt) {
    while ($true) {
        $v = Read-Host $Prompt
        if ($v -and $v.Trim().Length -gt 0) { return $v.Trim() }
        Write-Host "  Поле обязательное." -ForegroundColor Yellow
    }
}

Clear-Host
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host " beLLum — добавление Lava.ru (карта/СБП для РФ)" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host ""

# --- 1. Token --------------------------------------------------------------
Write-Host "=== Шаг 1: Personal Access Token Supabase ===" -ForegroundColor Cyan
Write-Host "  Открой https://supabase.com/dashboard/account/tokens" -ForegroundColor Gray
Write-Host "  Сгенерируй (или возьми существующий) sbp_..." -ForegroundColor Gray
Write-Host ""
Read-Host "Нажми Enter чтобы открыть страницу"
Start-Process "https://supabase.com/dashboard/account/tokens"
$pat = Read-Secret "Вставь токен (символы НЕ покажутся)"
$env:SUPABASE_ACCESS_TOKEN = $pat

try {
    $verifyHeaders = @{ "Authorization" = "Bearer $pat" }
    $projects = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects" -Headers $verifyHeaders -TimeoutSec 30
    $match = $projects | Where-Object { $_.id -eq $ProjectRef }
    if (-not $match) { Write-Host "  Проект $ProjectRef не найден." -ForegroundColor Red; exit 1 }
    Write-Host "  [OK] Авторизация работает." -ForegroundColor Green
} catch {
    Write-Host "  Токен не подошёл." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkGray
    exit 1
}

# --- 2. Lava credentials ---------------------------------------------------
Write-Host ""
Write-Host "=== Шаг 2: ключи Lava.ru ===" -ForegroundColor Cyan
Write-Host "  1. Открой https://business.lava.ru/" -ForegroundColor Gray
Write-Host "  2. Зарегистрируйся / войди (по номеру телефона, без ИП)." -ForegroundColor Gray
Write-Host "  3. Создай проект (например 'beLLum')." -ForegroundColor Gray
Write-Host "  4. Зайди в проект -> 'Настройки' / 'API'." -ForegroundColor Gray
Write-Host "  5. Скопируй:" -ForegroundColor Gray
Write-Host "       * ID проекта (UUID, например 0a1b2c3d-...)" -ForegroundColor Gray
Write-Host "       * Секретный ключ (Secret key для API)" -ForegroundColor Gray
Write-Host "  6. В разделе 'Webhook URL' впиши:" -ForegroundColor Gray
Write-Host "       https://$ProjectRef.supabase.co/functions/v1/payments-webhook/lava" -ForegroundColor Yellow
Write-Host "  7. Сохрани." -ForegroundColor Gray
Write-Host ""
Read-Host "Нажми Enter чтобы открыть Lava"
Start-Process "https://business.lava.ru/"
Write-Host ""
$lavaShop   = Read-Required "Lava Shop ID (UUID)"
$lavaSecret = Read-Secret  "Lava Secret Key"
Write-Host "  [OK] Ключи Lava приняты." -ForegroundColor Green

# --- 3. Apply provider migration ------------------------------------------
Write-Host ""
Write-Host "=== Шаг 3: разрешаю провайдер 'lava' в БД ===" -ForegroundColor Cyan
$mgmtUrl = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"
$mgmtHeaders = @{ "Authorization" = "Bearer $pat" }
$migrationFile = Join-Path $PSScriptRoot "supabase\migrations\20260427000004_payments_add_lava.sql"
$sql = [System.IO.File]::ReadAllText($migrationFile, [System.Text.UTF8Encoding]::new($false))
$payload = [ordered]@{ query = [string]$sql }
$bodyJson = $payload | ConvertTo-Json -Compress -Depth 3
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
try {
    Invoke-RestMethod -Method Post -Uri $mgmtUrl -Headers $mgmtHeaders -Body $bodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec 120 | Out-Null
    Write-Host "  [OK] провайдер lava теперь разрешён." -ForegroundColor Green
} catch {
    $err = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $err = $_.ErrorDetails.Message } else { $err = $_.Exception.Message }
    Write-Host "  Не удалось применить миграцию: $err" -ForegroundColor Red
    exit 1
}

# --- 4. Update secrets -----------------------------------------------------
Write-Host ""
Write-Host "=== Шаг 4: загружаю секреты Lava в Edge Functions ===" -ForegroundColor Cyan

$envFile = Join-Path $PSScriptRoot "supabase\.env.lava"
$envContent = "LAVA_SHOP_ID=$lavaShop`nLAVA_SECRET=$lavaSecret`n"
[System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.UTF8Encoding]::new($false))

$secretsOut = & supabase secrets set --env-file "supabase\.env.lava" --project-ref $ProjectRef 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Не удалось загрузить секреты:" -ForegroundColor Red
    Write-Host $secretsOut -ForegroundColor DarkGray
    exit 1
}
Remove-Item $envFile -ErrorAction SilentlyContinue
Write-Host "  [OK] секреты загружены." -ForegroundColor Green

# --- 5. Redeploy functions -------------------------------------------------
Write-Host ""
Write-Host "=== Шаг 5: деплой Edge Functions ===" -ForegroundColor Cyan

Write-Host "  Деплой create-invoice..." -ForegroundColor Gray
& supabase functions deploy create-invoice --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { Write-Host "  create-invoice провален" -ForegroundColor Red; exit 1 }
Write-Host "  [OK] create-invoice" -ForegroundColor Green

Write-Host "  Деплой payments-webhook..." -ForegroundColor Gray
& supabase functions deploy payments-webhook --no-verify-jwt --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { Write-Host "  payments-webhook провален" -ForegroundColor Red; exit 1 }
Write-Host "  [OK] payments-webhook" -ForegroundColor Green

# --- 6. Final ping ---------------------------------------------------------
Write-Host ""
Write-Host "Жду 5 сек, пингую..." -ForegroundColor Gray
Start-Sleep -Seconds 5

$pingUrl = "https://$ProjectRef.supabase.co/functions/v1/payments-webhook/lava"
try {
    $r = Invoke-WebRequest -Uri $pingUrl -Method Post -Body '{"x":1}' -ContentType "application/json" -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
    Write-Host ("Пинг: status {0}" -f $r.StatusCode) -ForegroundColor Green
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $code = [int]$resp.StatusCode
        if ($code -in 400,401,404) {
            Write-Host ("Пинг: status $code (функция жива)") -ForegroundColor Green
        } else {
            Write-Host ("Пинг: status $code") -ForegroundColor Yellow
        }
    } else {
        Write-Host ("Пинг упал: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host " ВСЁ ГОТОВО." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Webhook URL для Lava (если ещё не вписал):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  https://$ProjectRef.supabase.co/functions/v1/payments-webhook/lava" -ForegroundColor White
Write-Host ""
Write-Host "Открывай приложение -> Профиль -> 'Пополнить'." -ForegroundColor Yellow
Write-Host "Регион RU теперь использует Lava (карта/СБП/ЮMoney)." -ForegroundColor Yellow
Write-Host ""
