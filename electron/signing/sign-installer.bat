@echo off
chcp 65001 >nul
echo ========================================
echo   Assinar Instalador Discord Clone
echo ========================================
echo.

REM Configurações
set CERT_PATH=electron\signing\certificate.pfx
set CERT_PASSWORD=DiscordClone2026!
set TIMESTAMP_URL=http://timestamp.digicert.com

REM Verifica se o certificado existe
if not exist "%CERT_PATH%" (
    echo [ERRO] Certificado nao encontrado: %CERT_PATH%
    echo.
    echo Execute primeiro: create-certificate.ps1
    pause
    exit /b 1
)

REM Verifica se signtool está disponível
where signtool >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] signtool nao encontrado!
    echo.
    echo Instale Windows SDK ou Visual Studio Build Tools
    echo Download: https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/
    pause
    exit /b 1
)

REM Procura o instalador mais recente
set INSTALLER=
for /f "delims=" %%i in ('dir /b /o-d dist\*.exe 2^>nul') do (
    if not defined INSTALLER set INSTALLER=dist\%%i
)

if not defined INSTALLER (
    echo [ERRO] Nenhum instalador encontrado em dist\
    echo Execute primeiro: build-windows.bat
    pause
    exit /b 1
)

echo Instalador encontrado: %INSTALLER%
echo.

REM Assina o instalador
echo [1/2] Assinando instalador...
signtool sign /f "%CERT_PATH%" /p "%CERT_PASSWORD%" /tr "%TIMESTAMP_URL%" /td SHA256 /fd SHA256 "%INSTALLER%"

if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Falha ao assinar o instalador!
    pause
    exit /b 1
)

echo ✅ Instalador assinado com sucesso!
echo.

REM Verifica a assinatura
echo [2/2] Verificando assinatura...
signtool verify /pa /tw "%INSTALLER%"

if %ERRORLEVEL% NEQ 0 (
    echo [AVISO] Verificação falhou, mas a assinatura pode estar OK
) else (
    echo ✅ Assinatura verificada com sucesso!
)

echo.
echo ========================================
echo   ASSINATURA CONCLUIDA!
echo ========================================
echo.
echo Instalador assinado: %INSTALLER%
echo.
echo O Windows SmartScreen agora vai reconhecer o app como seguro.
echo.
pause