$ErrorActionPreference = "Stop"
$ProjectRef = "ekrxjbdkkkplxsnmmcgo"
$TokenFile  = Join-Path $PSScriptRoot ".supabase-token.local"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path $TokenFile)) {
    Write-Host "Сначала запусти simulate-payment.ps1 - он сохранит токен." -ForegroundColor Red
    exit 1
}
$pat = (Get-Content $TokenFile -Raw).Trim()

function Run-Sql([string]$sql) {
    $payload  = [ordered]@{ query = [string]$sql }
    $bodyJson = $payload | ConvertTo-Json -Compress -Depth 3
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
    return Invoke-RestMethod -Method Post `
        -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
        -Headers @{ "Authorization" = "Bearer $pat" } `
        -Body $bodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec 60
}

Write-Host ""
Write-Host "=== Все счета (последние 10) ===" -ForegroundColor Cyan
$inv = Run-Sql "select id, user_id, status, source_amount_minor, source_currency, balance_amount_minor, paid_at, created_at from public.payment_invoices order by created_at desc limit 10;"
foreach ($r in $inv) {
    $amt = [math]::Round([double]$r.source_amount_minor / 100, 2)
    $bal = [math]::Round([double]$r.balance_amount_minor / 100, 2)
    Write-Host (" {0}  {1}  {2} {3} -> {4} RUB  user={5}" -f `
        $r.id.Substring(0,8), $r.status.PadRight(8), $amt, $r.source_currency, $bal, $r.user_id.Substring(0,8))
}

Write-Host ""
Write-Host "=== Балансы пользователей с инвойсами ===" -ForegroundColor Cyan
$prof = Run-Sql "select p.id, p.balance, p.display_name from public.profiles p where p.id in (select distinct user_id from public.payment_invoices) order by p.balance desc;"
if (-not $prof -or $prof.Count -eq 0) {
    Write-Host " (нет таких пользователей)" -ForegroundColor Yellow
} else {
    foreach ($r in $prof) {
        Write-Host (" {0}  {1} RUB  ({2})" -f $r.id.Substring(0,8), $r.balance, $r.display_name)
    }
}

Write-Host ""
Write-Host "=== Последние записи в activity_feed (kind=balance_topup) ===" -ForegroundColor Cyan
try {
    $feed = Run-Sql "select user_id, payload, created_at from public.activity_feed where kind = 'balance_topup' order by created_at desc limit 5;"
    if (-not $feed -or $feed.Count -eq 0) {
        Write-Host " (пусто)" -ForegroundColor Yellow
    } else {
        foreach ($r in $feed) {
            Write-Host (" {0}  {1}  {2}" -f $r.created_at, $r.user_id.Substring(0,8), ($r.payload | ConvertTo-Json -Compress))
        }
    }
} catch {
    Write-Host " (таблицы activity_feed нет или ошибка - это не критично)" -ForegroundColor Yellow
}

Write-Host ""
