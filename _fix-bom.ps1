param([Parameter(Mandatory)][string]$Path)
$content = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
$utf8bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($Path, $content, $utf8bom)
Write-Host "OK: $Path re-saved with UTF-8 BOM"
