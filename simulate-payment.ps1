$ErrorActionPreference = "Stop"
$ProjectRef = "ekrxjbdkkkplxsnmmcgo"
$TokenFile  = Join-Path $PSScriptRoot ".supabase-token.local"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-SupabaseToken {
    if (Test-Path $TokenFile) {
        $tok = (Get-Content $TokenFile -Raw).Trim()
        if ($tok.StartsWith("sbp_")) { return $tok }
    }

    Clear-Host
    Write-Host "================================================================" -ForegroundColor Magenta
    Write-Host " Нужен Supabase токен (один раз - дальше будет помниться)" -ForegroundColor Magenta
    Write-Host "================================================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Сейчас откроется браузер на странице токенов Supabase." -ForegroundColor Gray
    Write-Host ""
    Write-Host " 1. Если ты уже залогинен - откроется список токенов." -ForegroundColor White
    Write-Host " 2. Нажми кнопку 'Generate new token'." -ForegroundColor White
    Write-Host " 3. Имя любое (например: bellum-local)." -ForegroundColor White
    Write-Host " 4. Нажми 'Generate token'." -ForegroundColor White
    Write-Host " 5. Скопируй ВЕСЬ ключ - он начинается с 'sbp_...'" -ForegroundColor White
    Write-Host "    (НЕ путать с 'sb_publishable_...' - это другой ключ)" -ForegroundColor Yellow
    Write-Host " 6. Вернись сюда и вставь его в поле ниже (Ctrl+V), нажми Enter." -ForegroundColor White
    Write-Host ""
    Write-Host "Готов? Жми Enter чтобы открыть браузер..." -ForegroundColor Cyan
    Read-Host | Out-Null

    Start-Process "https://supabase.com/dashboard/account/tokens"
    Write-Host ""

    while ($true) {
        $sec = Read-Host -AsSecureString "Вставь токен (sbp_...)"
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        $val  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr).Trim()
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

        if ($val.StartsWith("sbp_")) {
            $val | Set-Content -Path $TokenFile -Encoding UTF8 -NoNewline
            Write-Host "  [OK] Токен сохранён в .supabase-token.local (этот файл в .gitignore)." -ForegroundColor Green
            Write-Host ""
            return $val
        }
        Write-Host "  Это не похоже на правильный токен. Должен начинаться с 'sbp_'. Попробуй ещё раз." -ForegroundColor Red
    }
}

function Run-Sql([string]$sql, [string]$pat) {
    $payload  = [ordered]@{ query = [string]$sql }
    $bodyJson = $payload | ConvertTo-Json -Compress -Depth 3
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
    return Invoke-RestMethod -Method Post `
        -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
        -Headers @{ "Authorization" = "Bearer $pat" } `
        -Body $bodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec 60
}

# ============================================================

$pat = Get-SupabaseToken

# Один раз: применяем фикс confirm_payment (если ещё не применён)
$fixFlag = Join-Path $PSScriptRoot ".confirm-payment-fixed.local"
if (-not (Test-Path $fixFlag)) {
    Write-Host "Применяю фикс SQL-функции confirm_payment..." -ForegroundColor Cyan
    $migration = Join-Path $PSScriptRoot "supabase\migrations\20260427000005_payments_fix_confirm.sql"
    if (Test-Path $migration) {
        $sqlText = [System.IO.File]::ReadAllText($migration, [System.Text.Encoding]::UTF8)
        try {
            Run-Sql $sqlText $pat | Out-Null
            "applied" | Set-Content -Path $fixFlag -Encoding UTF8 -NoNewline
            Write-Host "  [OK] Фикс применён." -ForegroundColor Green
        } catch {
            $err = ""
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $err = $_.ErrorDetails.Message } else { $err = $_.Exception.Message }
            Write-Host "  Не удалось применить фикс: $err" -ForegroundColor Red
            exit 1
        }
    }
}

Clear-Host
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host " beLLum - симуляция оплаты" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "Что это: помечает твой последний 'pending' счёт как оплаченный" -ForegroundColor Gray
Write-Host "и зачисляет баланс - так же, как это делает реальный вебхук." -ForegroundColor Gray
Write-Host "Никакие реальные деньги НЕ списываются." -ForegroundColor Gray
Write-Host ""
Write-Host "Перед запуском: в приложении нажми 'Пополнить' -> 'Перейти к" -ForegroundColor Yellow
Write-Host "оплате' (откроется страница CryptoCloud) - этого достаточно," -ForegroundColor Yellow
Write-Host "чтобы создался pending-счёт." -ForegroundColor Yellow
Write-Host ""

Write-Host "Ищу последние pending-счета..." -ForegroundColor Cyan
try {
    $rows = Run-Sql "select id, user_id, provider, source_amount_minor, balance_amount_minor, source_currency, status, created_at from public.payment_invoices where status = 'pending' order by created_at desc limit 5;" $pat
} catch {
    $err = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $err = $_.ErrorDetails.Message } else { $err = $_.Exception.Message }
    Write-Host "  Ошибка обращения к БД: $err" -ForegroundColor Red
    Write-Host "  Возможно токен устарел. Удали .supabase-token.local и запусти скрипт снова." -ForegroundColor Yellow
    exit 1
}

if (-not $rows -or $rows.Count -eq 0) {
    Write-Host ""
    Write-Host "  Нет ни одного 'pending' счёта." -ForegroundColor Yellow
    Write-Host "  Сначала в приложении нажми 'Пополнить' -> 'Перейти к оплате'," -ForegroundColor Yellow
    Write-Host "  потом запусти скрипт ещё раз." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Нашёл pending-счета:" -ForegroundColor Gray
$i = 0
foreach ($row in $rows) {
    $i++
    $amount = [math]::Round([double]$row.source_amount_minor / 100, 2)
    Write-Host (" {0}) {1}  {2} {3}  ({4})" -f $i, $row.id.Substring(0,8), $amount, $row.source_currency, $row.provider) -ForegroundColor White
}
Write-Host ""

$choice = Read-Host "Какой пометить оплаченным? (Enter = первый)"
if (-not $choice) { $choice = "1" }
$idx = [int]$choice - 1
if ($idx -lt 0 -or $idx -ge $rows.Count) { Write-Host "Неверный выбор." -ForegroundColor Red; exit 1 }
$target = $rows[$idx]

Write-Host ""
$amount = [math]::Round([double]$target.source_amount_minor / 100, 2)
Write-Host ("Симулирую оплату: {0} {1} (счёт {2})" -f $amount, $target.source_currency, $target.id) -ForegroundColor Cyan

$sql = @"
select public.confirm_payment(
  p_invoice_id := '$($target.id)'::uuid,
  p_target_amount_minor := $($target.balance_amount_minor),
  p_provider_invoice_id := 'simulated-' || extract(epoch from now())::bigint,
  p_raw_callback := jsonb_build_object('source','simulate-payment.ps1','at',now()::text)
);
"@

try {
    Run-Sql $sql $pat | Out-Null
    Write-Host "  [OK] Платёж проведён через confirm_payment." -ForegroundColor Green
} catch {
    $err = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $err = $_.ErrorDetails.Message } else { $err = $_.Exception.Message }
    Write-Host "  Ошибка: $err" -ForegroundColor Red
    exit 1
}

$check = Run-Sql "select status from public.payment_invoices where id = '$($target.id)';" $pat
Write-Host ("  Статус счёта: {0}" -f $check[0].status) -ForegroundColor Green

$bal = Run-Sql "select balance from public.profiles where id = '$($target.user_id)';" $pat
if ($bal -and $bal.Count -gt 0) {
    $rub = [math]::Round([double]$bal[0].balance / 100, 2)
    Write-Host ("  Баланс пользователя: {0} ₽" -f $rub) -ForegroundColor Green
}

Write-Host ""
Write-Host "Готово! Открой приложение и потяни экран вниз - баланс обновится." -ForegroundColor Yellow
Write-Host ""
