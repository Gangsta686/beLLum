﻿$ErrorActionPreference = "Stop"
$ProgressPreference   = "SilentlyContinue"

$ProjectRef = "ekrxjbdkkkplxsnmmcgo"
$CliPath    = "$env:USERPROFILE\.supabase-cli"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step([int]$n, [string]$t) {
    Write-Host ""
    Write-Host ("=== Шаг {0}: {1} ===" -f $n, $t) -ForegroundColor Cyan
}
function Write-Ok([string]$t)   { Write-Host ("  [OK] {0}" -f $t) -ForegroundColor Green }
function Write-Info([string]$t) { Write-Host ("  {0}" -f $t) -ForegroundColor Gray }
function Write-Bad([string]$t)  { Write-Host ("  [ОШИБКА] {0}" -f $t) -ForegroundColor Red }

function Read-Required([string]$Prompt) {
    while ($true) {
        $v = Read-Host $Prompt
        if ($v -and $v.Trim().Length -gt 0) { return $v.Trim() }
        Write-Host "  Поле обязательное, попробуй ещё раз." -ForegroundColor Yellow
    }
}

function Read-Secret([string]$Prompt) {
    while ($true) {
        $sec = Read-Host -AsSecureString $Prompt
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        $val  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
        if ($val -and $val.Trim().Length -gt 0) { return $val.Trim() }
        Write-Host "  Поле обязательное, попробуй ещё раз." -ForegroundColor Yellow
    }
}

Clear-Host
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host " beLLum — установка платежей (CryptoCloud)" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta

if (Test-Path "$CliPath\supabase.exe") {
    $env:Path = "$CliPath;" + $env:Path
}
$cli = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $cli) {
    Write-Bad "Supabase CLI не найден. Перезапусти PowerShell и попробуй снова."
    exit 1
}

Write-Step 1 "Personal Access Token Supabase"
Write-Info "Сейчас откроется страница токенов Supabase."
Write-Info "Нажми 'Generate new token', придумай имя (например beLLum),"
Write-Info "нажми 'Generate token', СКОПИРУЙ токен (он показывается ОДИН раз)"
Write-Info "и вернись сюда."
Write-Host ""
Read-Host "Нажми Enter чтобы открыть страницу"
Start-Process "https://supabase.com/dashboard/account/tokens"
Write-Host ""
$pat = Read-Secret "Вставь сюда токен (символы НЕ отобразятся - это нормально)"
$env:SUPABASE_ACCESS_TOKEN = $pat
Write-Ok "Токен принят."

try {
    $verifyHeaders = @{ "Authorization" = "Bearer $pat" }
    $projects = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects" -Headers $verifyHeaders -TimeoutSec 30
    $match = $projects | Where-Object { $_.id -eq $ProjectRef }
    if (-not $match) {
        Write-Bad ("Токен валиден, но проект {0} не найден в твоём аккаунте." -f $ProjectRef)
        Write-Info ("Найденные проекты: {0}" -f (($projects | ForEach-Object { $_.id }) -join ", "))
        exit 1
    }
    Write-Ok ("Авторизация в Supabase работает. Проект: {0}" -f $match.name)
} catch {
    Write-Bad "Токен не подошёл или нет интернета."
    Write-Host $_.Exception.Message -ForegroundColor DarkGray
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor DarkGray
    }
    exit 1
}

Write-Step 2 "Ключи CryptoCloud"
Write-Info "Сейчас откроется страница твоих проектов CryptoCloud."
Write-Info "Зайди в свой проект (касса beLLum) и скопируй три значения:"
Write-Info "   * Shop ID  (UUID, например 01234567-89ab-cdef-...)"
Write-Info "   * API Token (длинная строка)"
Write-Info "   * Postback Secret (отдельный ключ для верификации уведомлений)"
Write-Host ""
Read-Host "Нажми Enter чтобы открыть страницу"
Start-Process "https://app.cryptocloud.plus/projects"
Write-Host ""
$ccShop   = Read-Required "CryptoCloud Shop ID (UUID)"
$ccApiKey = Read-Secret  "CryptoCloud API Token"
$ccSecret = Read-Secret  "CryptoCloud Postback Secret"
Write-Ok "Ключи CryptoCloud приняты."

Write-Step 3 "Применяю SQL-миграции"

$migrationsDir = Join-Path $PSScriptRoot "supabase\migrations"
if (-not (Test-Path $migrationsDir)) {
    Write-Bad "Папка $migrationsDir не найдена."
    exit 1
}
$migrationFiles = Get-ChildItem $migrationsDir -Filter *.sql | Sort-Object Name

$mgmtHeaders = @{ "Authorization" = "Bearer $pat" }
$mgmtUrl = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"

foreach ($f in $migrationFiles) {
    $name = $f.Name
    Write-Info ("Применяю {0} ..." -f $name)

    $sql = [System.IO.File]::ReadAllText($f.FullName, [System.Text.UTF8Encoding]::new($false))

    $payload = [ordered]@{ query = [string]$sql }
    $bodyJson = $payload | ConvertTo-Json -Compress -Depth 3
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

    try {
        Invoke-RestMethod -Method Post -Uri $mgmtUrl -Headers $mgmtHeaders `
            -Body $bodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec 240 | Out-Null
        Write-Ok ("{0} применён." -f $name)
    } catch {
        $errMsg = ""
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $errMsg = $_.ErrorDetails.Message }
        else { $errMsg = $_.Exception.Message }

        if ($errMsg -match "already exists" -or $errMsg -match "duplicate" -or $errMsg -match "уже существует") {
            Write-Ok ("{0} — объекты уже есть, пропускаю." -f $name)
        } else {
            Write-Bad ("{0} не применился." -f $name)
            Write-Host $errMsg -ForegroundColor DarkGray
            Write-Host ""
            Write-Host "  Если это безобидная ошибка (например 'already exists') — нажми y." -ForegroundColor Yellow
            $answer = Read-Host "  Продолжить? (y/n)"
            if ($answer -ne "y") { exit 1 }
        }
    }
}

Write-Step 4 "Загружаю секреты"

$envPaymentsPath = "supabase\.env.payments"
$envPaymentsContent = @"
CRYPTOCLOUD_API_KEY=$ccApiKey
CRYPTOCLOUD_SHOP_ID=$ccShop
CRYPTOCLOUD_SECRET=$ccSecret
PAYMENTS_RETURN_URL=https://celadon-arithmetic-d84d59.netlify.app/?status=return
"@
[System.IO.File]::WriteAllText(
    (Join-Path $PSScriptRoot $envPaymentsPath),
    $envPaymentsContent,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Ok ("Файл {0} записан." -f $envPaymentsPath)

$secretsOut = & supabase secrets set --env-file $envPaymentsPath --project-ref $ProjectRef 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Bad "Не удалось загрузить секреты:"
    Write-Host $secretsOut -ForegroundColor DarkGray
    exit 1
}
Write-Ok "Секреты загружены."

Write-Step 5 "Деплой Edge Functions"

Write-Info "Деплой create-invoice ..."
$createOut = & supabase functions deploy create-invoice --project-ref $ProjectRef 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Bad "Деплой create-invoice провалился:"
    Write-Host $createOut -ForegroundColor DarkGray
    exit 1
}
Write-Ok "create-invoice задеплоен."

Write-Info "Деплой payments-webhook ..."
$webhookOut = & supabase functions deploy payments-webhook --no-verify-jwt --project-ref $ProjectRef 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Bad "Деплой payments-webhook провалился:"
    Write-Host $webhookOut -ForegroundColor DarkGray
    exit 1
}
Write-Ok "payments-webhook задеплоен."

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host " ВСЁ ГОТОВО." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Последнее ручное действие в CryptoCloud:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Проект -> Настройки -> 'URL для уведомлений' впиши:" -ForegroundColor Yellow
Write-Host ""
Write-Host ("  https://{0}.supabase.co/functions/v1/payments-webhook/cryptocloud" -f $ProjectRef) -ForegroundColor White
Write-Host ""
Write-Host "Сохрани. После этого открывай приложение -> Профиль -> 'Пополнить'." -ForegroundColor Yellow
Write-Host ""
