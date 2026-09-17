@echo off
rem ===========================================================================
rem  1-ACTUALIZAR-DATOS.BAT   -   doble clic
rem ---------------------------------------------------------------------------
rem  Baja los tres snapshots locales de Yahoo y despues corre las 20 pruebas.
rem  NO toca git. Para subir, se usa 2-subir-cambios.bat.
rem
rem  POR QUE EXISTE ESTE ARCHIVO
rem  Vercel no puede llamar a Yahoo: Yahoo bloquea las IP de datacenter. Todo
rem  dato de Yahoo entra al proyecto por aca, desde esta PC, y viaja al deploy
rem  como archivo JSON commiteado. Si este bat no corre, la web sigue mostrando
rem  el snapshot viejo.
rem
rem  EL ORDEN NO ES ARBITRARIO
rem    1. fetch_fundamentals.py  -> sp500_fundamentals.json + informe_consenso.json
rem    2. fetch_informe.py       -> informe_detalle.json      (lee el 1)
rem    3. fetch_historico.py     -> historico_precios.json    (lee el 1)
rem  Si el paso 1 falla, los otros dos trabajarian sobre datos viejos sin
rem  avisar. Por eso corta en el primer error y no sigue.
rem
rem  SIN ACENTOS A PROPOSITO
rem  cmd.exe y los acentos se llevan mal segun la pagina de codigos. El texto
rem  va en ASCII para que se lea igual en cualquier maquina. Los bots de Python
rem  si imprimen acentos; para eso esta el chcp 65001 de abajo.
rem
rem  EL UNIVERSO DEL INFORME NO ES EL DEL SCREENER
rem  fetch_informe.py SIN argumentos cae a local_bot/tickers_informe.txt, que
rem  tiene 7 papeles. El universo real del informe son ~326 y se pide con
rem  --cedears --cedears-extra --medibles. La primera version de este .bat no
rem  los pasaba: refrescaba 7 de 326 y los otros 319 quedaban congelados con
rem  la fecha de la ultima corrida que si los habia pedido.
rem
rem  --dias 7 saltea lo bajado hace menos de una semana. A 3,1 s por papel,
rem  un refresco completo son ~17 minutos, y los fundamentales del informe no
rem  cambian de un dia para el otro. Con `informe` se fuerza el completo.
rem
rem  ARGUMENTOS
rem    (ninguno)   baja los datos y corre las pruebas
rem    pruebas     solo corre las pruebas, no baja nada    (no gasta ni tiempo
rem                ni llamadas a Yahoo: sirve para chequear despues de editar)
rem    informe     fuerza el refresco COMPLETO del informe (~17 min), sin el
rem                salteo de --dias. Para cuando entran papeles nuevos.
rem    cedears     ADEMAS revalida el universo de CEDEARs (~5 min extra).
rem                Solo hace falta cuando se agregan o sacan papeles de
rem                local_bot/cedears_informe.py. No es parte del dia a dia.
rem ===========================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
title Actualizar datos - screener e informe

rem  Los argumentos se COMBINAN. La primera version leia solo %1, asi que pedir
rem  `cedears informe` hacia una sola de las dos y la otra se perdia en
rem  silencio: el mismo tipo de falla que el .bat que refrescaba 7 papeles de
rem  326 sin decir nada. Un argumento que no se reconoce ahora corta.
set SOLO_PRUEBAS=
set HACER_CEDEARS=
set INFORME_COMPLETO=
:leer_args
if "%~1"=="" goto :args_listos
set CONOCIDO=
if /i "%~1"=="pruebas" set SOLO_PRUEBAS=1
if /i "%~1"=="pruebas" set CONOCIDO=1
if /i "%~1"=="cedears" set HACER_CEDEARS=1
if /i "%~1"=="cedears" set CONOCIDO=1
if /i "%~1"=="informe" set INFORME_COMPLETO=1
if /i "%~1"=="informe" set CONOCIDO=1
if not defined CONOCIDO (
  echo.
  echo   [X] No entiendo el argumento "%~1".
  echo       Los que existen son:  pruebas  ^|  cedears  ^|  informe
  echo       Se pueden combinar:   1-actualizar-datos.bat cedears informe
  echo.
  pause
  exit /b 1
)
shift
goto :leer_args
:args_listos

set LOGS=%TEMP%\sp500-bat
if not exist "%LOGS%" mkdir "%LOGS%" >nul 2>&1

echo.
echo ===========================================================================
echo   ACTUALIZAR DATOS   -   %DATE% %TIME:~0,5%
echo ===========================================================================
echo.

rem --- 0. Estamos donde creemos que estamos? -------------------------------
if not exist "public\data" (
  echo   [X] No encuentro la carpeta public\data.
  echo       Este .bat tiene que estar en la raiz del repo, al lado de
  echo       package.json y de la carpeta local_bot.
  goto :fin_error
)
if not exist "local_bot\fetch_fundamentals.py" (
  echo   [X] No encuentro local_bot\fetch_fundamentals.py.
  goto :fin_error
)

rem --- 0b. Python y Node ----------------------------------------------------
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY ( python --version >nul 2>&1 && set PY=python )
if not defined PY (
  echo   [X] No encuentro Python. Instalalo desde python.org y marca
  echo       "Add Python to PATH" durante la instalacion.
  goto :fin_error
)
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] No encuentro Node. Instalalo desde nodejs.org.
  echo       Node se usa solo para las pruebas, no para bajar datos.
  goto :fin_error
)
for /f "tokens=*" %%V in ('%PY% --version 2^>^&1') do set PYVER=%%V
for /f "tokens=*" %%V in ('node --version 2^>^&1') do set NODEVER=%%V
echo   %PYVER%  -  node %NODEVER%
echo.

if defined SOLO_PRUEBAS (
  echo   Modo PRUEBAS: no se baja nada de Yahoo.
  echo.
  goto :pruebas
)
echo   Plan de esta corrida:
echo     - fundamentales del S^&P 500
if defined HACER_CEDEARS echo     - revalidar el universo de CEDEARs   ^(~5 min^)
if defined INFORME_COMPLETO echo     - informe COMPLETO, todo el universo   ^(~17 min^)
if not defined INFORME_COMPLETO echo     - informe, solo lo de mas de 7 dias
echo     - historico de precios
echo     - las pruebas
echo.

rem --- 1. Fundamentales -----------------------------------------------------
echo ---------------------------------------------------------------------------
echo   [1/3] Fundamentales del S^&P 500          ~3 a 5 minutos
echo ---------------------------------------------------------------------------
%PY% "local_bot\fetch_fundamentals.py"
if errorlevel 1 (
  echo.
  echo   [X] fetch_fundamentals.py fallo.
  echo       CORTO ACA A PROPOSITO: los otros dos bots leen este archivo, y si
  echo       siguieran, escribirian datos nuevos armados sobre uno viejo.
  goto :fin_error
)
echo.

rem --- 1b. Revalidar CEDEARs (opcional) ------------------------------------
if defined HACER_CEDEARS (
  echo ---------------------------------------------------------------------------
  echo   [extra] Revalidar el universo de CEDEARs   ~5 minutos
  echo ---------------------------------------------------------------------------
  %PY% "local_bot\validar_cedears.py"
  if errorlevel 1 (
    echo.
    echo   [X] validar_cedears.py fallo. Sin cedears_ok.txt fresco, el
    echo       historico baja el universo viejo.
    goto :fin_error
  )
  echo.
)

rem --- 2. Detalle del informe ----------------------------------------------
rem  Las tres banderas son el universo del informe: los CEDEAR del S&P, los de
rem  afuera del indice, y las del Merval que solo se miden. Sin ellas el bot
rem  cae a tickers_informe.txt y refresca 7 papeles de 326.
set UNIVERSO_INFORME=--cedears --cedears-extra --medibles
set SALTEO_INFORME=--dias 7
if defined INFORME_COMPLETO set SALTEO_INFORME=
echo ---------------------------------------------------------------------------
if defined SALTEO_INFORME (
  echo   [2/3] Detalle del informe                 solo lo de mas de 7 dias
) else (
  echo   [2/3] Detalle del informe                 COMPLETO, ~17 minutos
)
echo ---------------------------------------------------------------------------
%PY% "local_bot\fetch_informe.py" %UNIVERSO_INFORME% %SALTEO_INFORME%
if errorlevel 1 (
  echo.
  echo   [X] fetch_informe.py fallo.
  goto :fin_error
)
echo.

rem --- 3. Historico de precios ---------------------------------------------
echo ---------------------------------------------------------------------------
echo   [3/3] Historico de precios                ~3 a 6 minutos
echo ---------------------------------------------------------------------------
%PY% "local_bot\fetch_historico.py"
if errorlevel 1 (
  echo.
  echo   [X] fetch_historico.py fallo.
  goto :fin_error
)
echo.

:pruebas
rem --- 4. Las pruebas -------------------------------------------------------
echo ---------------------------------------------------------------------------
echo   PRUEBAS
echo ---------------------------------------------------------------------------
rem  Cada suite corre UNA sola vez. Las que fallan quedan anotadas en un
rem  archivo con el nombre de su log, y recien al final se imprimen. Volver a
rem  correrlas para averiguar cual fallo duplicaria el tiempo y, peor, podria
rem  dar distinto si alguna dependiera del reloj o de un archivo recien escrito.
set FALLAS=0
set CORRIDAS=0
set LISTA=%LOGS%\fallaron.txt
if exist "%LISTA%" del "%LISTA%" >nul 2>&1

for %%T in (test\prueba-*.cjs) do call :suite node "%%T"
for %%T in (test\test_*.py)   do call :suite "%PY%" "%%T"

echo.
if !FALLAS! EQU 0 goto :sin_fallas

echo   !FALLAS! de !CORRIDAS! suites fallaron. El detalle de cada una:
echo.
for /f "usebackq tokens=*" %%L in ("%LISTA%") do call :volcar "%%L"
echo   NO SUBAS ESTO. Arregla lo que falla y volve a correr este .bat.
echo   Podes repetir solo las pruebas, sin bajar datos, con:
echo       1-actualizar-datos.bat pruebas
goto :fin_error

:sin_fallas
echo   Las !CORRIDAS! suites pasaron.
echo.

rem --- 5. Que quedo en disco -----------------------------------------------
echo ---------------------------------------------------------------------------
echo   ARCHIVOS GENERADOS
echo ---------------------------------------------------------------------------
call :ver "public\data\sp500_fundamentals.json"
call :ver "public\data\informe_consenso.json"
call :ver "public\data\informe_detalle.json"
call :ver "public\data\historico_precios.json"
echo.
echo ===========================================================================
echo   LISTO. Los datos estan actualizados en disco, pero NO subidos.
echo   Para que la web los use, corre ahora:   2-subir-cambios.bat
echo ===========================================================================
echo.
pause
endlocal
exit /b 0

:ver
if exist %1 (
  for %%F in (%1) do echo    %%~tF   %%~zF bytes   %%~nxF
) else (
  echo    [falta]                       %~nx1
)
exit /b 0

rem  :suite <interprete> <archivo>   corre una suite y anota si fallo
:suite
set /a CORRIDAS+=1
set ARCH=%~2
set LOG=%LOGS%\%~n2.log
%~1 "%ARCH%" >"%LOG%" 2>&1
if errorlevel 1 (
  set /a FALLAS+=1
  echo    [X] %~nx2
  >>"%LISTA%" echo %~nx2
) else (
  echo    [ok] %~nx2
)
exit /b 0

rem  :volcar <nombre-del-archivo-de-prueba>   imprime su log
rem  El log no se guarda en la lista: se recalcula del nombre. Meter una ruta
rem  con un separador dentro de un bloque entre parentesis obliga a escapar el
rem  caracter, y eso en cmd es de las cosas que fallan el dia que la ruta tiene
rem  un espacio.
:volcar
echo   ------- %~1 -------
if exist "%LOGS%\%~n1.log" type "%LOGS%\%~n1.log"
echo.
exit /b 0

:fin_error
echo.
echo ===========================================================================
echo   SE CORTO. No se subio nada; el repo quedo como estaba.
echo ===========================================================================
echo.
pause
endlocal
exit /b 1
