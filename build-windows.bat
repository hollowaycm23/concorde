@echo off
chcp 65001 >nul
echo ========================================
echo   Concorde - Build Windows
echo ========================================
echo.

REM Verifica Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Baixe em: https://nodejs.org
    pause
    exit /b 1
)

echo [1/6] Instalando dependencias...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Falha ao instalar dependencias
    pause
    exit /b 1
)

echo.
echo [2/6] Verificando icones...
if not exist "electron\concorde.ico" (
    echo [AVISO] Icone nao encontrado em electron\concorde.ico
)

echo.
echo [3/6] Verificando certificado...
if not exist "electron\signing\certificate.pfx" (
    echo [AVISO] Certificado nao encontrado!
    echo.
    echo Deseja criar um certificado auto-assinado agora? (S/N)
    set /p CREATE_CERT=
    if /i "%CREATE_CERT%"=="S" (
        echo.
        echo Executando create-certificate.ps1...
        powershell -ExecutionPolicy Bypass -File "electron\signing\create-certificate.ps1"
        if %ERRORLEVEL% NEQ 0 (
            echo [ERRO] Falha ao criar certificado
            pause
            exit /b 1
        )
    ) else (
        echo [AVISO] Build continuara sem assinatura
        set SKIP_SIGN=1
    )
)

echo.
echo [4/6] Limpando builds anteriores...
if exist "dist" rmdir /s /q dist

echo.
echo [5/6] Gerando instalador Windows (NSIS)...
call npm run build:installer
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Falha ao gerar instalador
    pause
    exit /b 1
)

echo.
if not defined SKIP_SIGN (
    echo [6/6] Assinando instalador...
    call "electron\signing\sign-installer.bat"
) else (
    echo [6/6] Pulando assinatura (certificado nao encontrado)
)

echo.
echo ========================================
echo   BUILD CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo Arquivos gerados em: dist\
echo.
dir dist\*.exe 2>nul
echo.
echo Para instalar: execute o arquivo .exe em dist\
echo.
pause
