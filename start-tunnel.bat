@echo off
title Concorde - Cloudflare Tunnel (HTTPS)
where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
  echo Cloudflared nao encontrado. Instalando via winget...
  winget install --id Cloudflare.cloudflared -e --silent
  if %errorlevel% neq 0 (
    echo Falha. Instale manualmente: winget install Cloudflare.cloudflared
    pause
    exit /b 1
  )
)
echo.
echo Iniciando tunel HTTPS para http://localhost:3000 ...
echo Copie a URL https://xxx.trycloudflare.com que aparecer e compartilhe.
echo Convidado: no Concorde dele clique em 🌐 Trocar servidor e cole a URL https
echo.
cloudflared tunnel --url http://localhost:3000
pause