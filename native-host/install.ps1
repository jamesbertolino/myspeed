# MySpeed WiFi Native Host Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1 [-ExtensionId <id>]
param(
  [string]$ExtensionId = ""
)

$HostName    = "com.myspeed.wifi"
$HostScript  = Join-Path $PSScriptRoot "wifi-host.bat"
$ManifestOut = Join-Path $PSScriptRoot "$HostName.json"

# Verify node is available
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js nao encontrado. Instale em https://nodejs.org"
  exit 1
}

# Ask for extension ID if not provided
if (-not $ExtensionId) {
  Write-Host ""
  Write-Host "Para encontrar o ID da extensao:"
  Write-Host "  1. Abra chrome://extensions"
  Write-Host "  2. Ative 'Modo do desenvolvedor'"
  Write-Host "  3. Clique em 'Carregar sem compactacao' e selecione a pasta 'extension'"
  Write-Host "  4. Copie o ID exibido (ex: abcdefghijklmnopqrstuvwxyz123456)"
  Write-Host ""
  $ExtensionId = Read-Host "Cole o ID da extensao aqui"
}

if (-not $ExtensionId -or $ExtensionId.Length -lt 10) {
  Write-Error "ID de extensao invalido."
  exit 1
}

# Write native host manifest
$manifest = @{
  name             = $HostName
  description      = "MySpeed WiFi Scanner"
  path             = $HostScript
  type             = "stdio"
  allowed_origins  = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json

[System.IO.File]::WriteAllText($ManifestOut, $manifest, [System.Text.Encoding]::UTF8)
Write-Host "Manifesto criado: $ManifestOut"

# Register in Windows registry for Chrome and Edge
$regPaths = @(
  "HKCU:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$HostName"
)
foreach ($path in $regPaths) {
  try {
    New-Item -Force -Path $path -Value $ManifestOut -ErrorAction Stop | Out-Null
    Write-Host "Registrado: $path"
  } catch {
    Write-Warning "Nao foi possivel registrar $path : $_"
  }
}

Write-Host ""
Write-Host "Instalacao concluida!" -ForegroundColor Green
Write-Host "Reinicie o Chrome/Edge e acesse o site para escanear redes WiFi reais."
