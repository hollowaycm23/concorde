# Script para criar certificado de code-signing auto-assinado
# Execute como Administrador no PowerShell

param(
    [string]$SubjectName = "Discord Clone",
    [string]$Password = "DiscordClone2026!",
    [int]$ValidYears = 3
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Criando Certificado de Code-Signing" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verifica se está executando como admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "[ERRO] Execute este script como Administrador!" -ForegroundColor Red
    exit 1
}

$certPath = Join-Path $PSScriptRoot "certificate.pfx"
$cerPath = Join-Path $PSScriptRoot "certificate.cer"

# Remove certificados anteriores
if (Test-Path $certPath) { Remove-Item $certPath -Force }
if (Test-Path $cerPath) { Remove-Item $cerPath -Force }

Write-Host "[1/4] Gerando certificado..." -ForegroundColor Yellow

try {
    # Cria certificado auto-assinado para code-signing
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=$SubjectName, O=Discord Clone, C=BR" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyUsage DigitalSignature `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears($ValidYears) `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    
    Write-Host "✅ Certificado criado com sucesso!" -ForegroundColor Green
    Write-Host "   Thumbprint: $($cert.Thumbprint)" -ForegroundColor Gray
    Write-Host "   Válido até: $($cert.NotAfter)" -ForegroundColor Gray
    Write-Host ""
    
    # Exporta para PFX (com chave privada)
    Write-Host "[2/4] Exportando certificado PFX..." -ForegroundColor Yellow
    
    $securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $securePassword | Out-Null
    
    Write-Host "✅ PFX exportado: $certPath" -ForegroundColor Green
    Write-Host ""
    
    # Exporta para CER (chave pública)
    Write-Host "[3/4] Exportando certificado público..." -ForegroundColor Yellow
    
    Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
    
    Write-Host "✅ CER exportado: $cerPath" -ForegroundColor Green
    Write-Host ""
    
    # Instala no repositório de autoridades confiáveis (opcional)
    Write-Host "[4/4] Instalando certificado no sistema..." -ForegroundColor Yellow
    
    Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null
    Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
    
    Write-Host "✅ Certificado instalado no sistema!" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  CERTIFICADO CRIADO COM SUCESSO!" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Arquivos gerados:" -ForegroundColor White
    Write-Host "  • certificate.pfx (chave privada + pública)" -ForegroundColor Gray
    Write-Host "  • certificate.cer (apenas chave pública)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Senha do PFX: $Password" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "IMPORTANTE:" -ForegroundColor Red
    Write-Host "  • Guarde o PFX em local seguro!" -ForegroundColor Yellow
    Write-Host "  • NÃO compartilhe o PFX publicamente!" -ForegroundColor Yellow
    Write-Host "  • Para produção, compre um certificado real!" -ForegroundColor Yellow
    Write-Host ""
    
} catch {
    Write-Host "[ERRO] Falha ao criar certificado: $_" -ForegroundColor Red
    exit 1
}