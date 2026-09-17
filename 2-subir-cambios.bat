@echo off
rem ===========================================================================
rem  2-SUBIR-CAMBIOS.BAT   -   doble clic
rem ---------------------------------------------------------------------------
rem  git add + commit + push. Es el unico paso irreversible de todo el flujo:
rem  una vez que el push sale, Vercel redeploya solo y la web publica cambia.
rem  Por eso muestra TODO lo que va a subir y pide confirmacion antes.
rem
rem  NO baja datos. Para eso esta 1-actualizar-datos.bat, que ademas corre las
rem  pruebas. El orden pensado es: 1 primero, 2 despues.
rem
rem  DOBLE CLIC, NO POR CLAUDE
rem  Este archivo lo corres vos, en tu maquina. Claude no puede correr git por
rem  el puente de archivos: deja un .git\index.lock que despues no se puede
rem  borrar desde el puente y el repo queda trabado. Esa es, justamente, la
rem  razon por la que este .bat existe.
rem
rem  SIN ACENTOS A PROPOSITO: ver la nota en 1-actualizar-datos.bat.
rem ===========================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Subir cambios y desplegar

echo.
echo ===========================================================================
echo   SUBIR CAMBIOS   -   %DATE% %TIME:~0,5%
echo ===========================================================================
echo.

rem --- 0. Chequeos previos --------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo   [X] No encuentro git. Instalalo desde git-scm.com.
  goto :fin_error
)
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo   [X] Esta carpeta no es un repositorio git.
  goto :fin_error
)
if exist ".git\index.lock" (
  echo   [X] Hay un .git\index.lock. Eso quiere decir que quedo un git a medias.
  echo       Cerra cualquier programa que este usando el repo, borra a mano el
  echo       archivo .git\index.lock y volve a correr este .bat.
  goto :fin_error
)

for /f "tokens=*" %%B in ('git rev-parse --abbrev-ref HEAD') do set RAMA=%%B
echo   Rama actual: !RAMA!
echo.

rem --- 1. Hay algo para subir? ---------------------------------------------
rem  Se cuenta por TAMANO del archivo, no con `find /c`: con chcp 65001 activo
rem  `find` cuenta mal las lineas con acentos, y un nombre de archivo con enie
rem  alcanzaria para que este .bat crea que no hay nada y se vaya sin subir.
set NCAMBIOS=0
rem  -uall lista CADA archivo sin trackear. Sin eso, una CARPETA nueva se
rem  muestra colapsada como una sola linea ("test/") y no se ve que adentro hay
rem  cuatro archivos. Se suben igual con `git add -A`, pero la lista que mira
rem  Marcos antes de confirmar tiene que decir la verdad completa.
git status --porcelain -uall >"%TEMP%\sp500-status.txt" 2>&1
for %%F in ("%TEMP%\sp500-status.txt") do if %%~zF GTR 0 set NCAMBIOS=1

if "!NCAMBIOS!"=="0" (
  echo   No hay ningun cambio para subir. El repo esta limpio.
  echo.
  echo   Si esperabas cambios: corriste 1-actualizar-datos.bat antes?
  goto :fin_ok
)

echo ---------------------------------------------------------------------------
echo   LO QUE SE VA A SUBIR
echo ---------------------------------------------------------------------------
echo.
echo    M = modificado   A = nuevo   D = borrado   ?? = sin trackear
echo.
type "%TEMP%\sp500-status.txt"
echo.

rem --- 1b. Guarda contra subir secretos ------------------------------------
rem  .gitignore ya cubre .env, pero un archivo nuevo con otro nombre no lo
rem  cubre nadie. Una clave publicada en GitHub hay que rotarla, no borrarla:
rem  queda en el historial para siempre. Este chequeo cuesta un segundo.
set PELIGRO=0
findstr /i /c:".env" /c:"secret" /c:"apikey" /c:"api_key" /c:"credenciales" "%TEMP%\sp500-status.txt" >nul 2>&1
if not errorlevel 1 set PELIGRO=1
if "!PELIGRO!"=="1" (
  echo   ---------------------------------------------------------------------
  echo   [AVISO] ATENCION: alguno de esos archivos tiene pinta de tener claves.
  echo       Miralo bien antes de seguir. Una clave que llega a GitHub hay que
  echo       rotarla en la consola del proveedor; borrar el archivo despues no
  echo       alcanza, queda en el historial.
  echo   ---------------------------------------------------------------------
  echo.
)

rem --- 2. Confirmacion ------------------------------------------------------
set RESP=
set /p RESP=  Subir estos cambios? (s = si / cualquier otra tecla = cancelar):
if /i not "!RESP!"=="s" (
  echo.
  echo   Cancelado. No se toco nada: los archivos siguen en disco sin subir.
  goto :fin_ok
)
echo.

rem --- 3. Mensaje del commit ------------------------------------------------
set MSG=
set /p MSG=  Mensaje del commit (Enter para el de siempre):
if "!MSG!"=="" set MSG=chore: actualizar snapshots locales (%DATE%)
echo.

rem --- 4. add + commit ------------------------------------------------------
echo   Agregando...
git add -A
if errorlevel 1 (
  echo   [X] git add fallo.
  goto :fin_error
)
rem  `git add -A` desde la raiz toma TODO: modificados, nuevos y borrados, en
rem  toda la carpeta, salvo lo que excluya .gitignore (node_modules, dist, .env
rem  y los caches de los bots). Pero que lo tome no se ve, asi que aca lo dice
rem  GIT mismo: este resumen sale del indice ya armado, no de una cuenta hecha
rem  a mano en este .bat.
echo.
echo   ESTO ES LO QUE QUEDO EN EL COMMIT, contado por git:
echo   ---------------------------------------------------------------------
git diff --cached --stat
echo   ---------------------------------------------------------------------
echo.
echo   Commiteando...
git commit -m "!MSG!"
if errorlevel 1 (
  echo   [X] git commit fallo. Nada se subio.
  echo       Si dice "nothing to commit", es que los cambios ya estaban
  echo       commiteados y solo falta el push: corre  git push  a mano.
  goto :fin_error
)
echo.

rem --- 5. push --------------------------------------------------------------
echo   Subiendo a origin/!RAMA!...
git push origin !RAMA!
if errorlevel 1 (
  echo.
  echo   [X] El push fallo. El commit SI quedo hecho en tu maquina, asi que no
  echo       perdiste nada. Las dos causas habituales:
  echo.
  echo       a^) El remoto tiene commits que vos no tenes. Se arregla con:
  echo              git pull --rebase
  echo              git push
  echo          NO lo hace este .bat solo: un rebase puede dar conflictos y
  echo          eso se resuelve mirando, no a ciegas.
  echo.
  echo       b^) Credenciales. Corre  git push  a mano una vez y resolve el
  echo          login que te pida; despues este .bat vuelve a andar.
  goto :fin_error
)


rem --- 6. LA VERIFICACION ---------------------------------------------------
rem  Esta es la parte que faltaba. Antes el .bat mostraba la lista y confiaba:
rem  si algo se hubiera quedado afuera, nadie se enteraba. Ahora se prueban las
rem  dos cosas que tienen que ser ciertas DESPUES del push.
echo.
echo ---------------------------------------------------------------------------
echo   VERIFICACION
echo ---------------------------------------------------------------------------

rem  (a) No quedo nada sin commitear.
set QUEDA=0
git status --porcelain -uall >"%TEMP%\sp500-verif.txt" 2>&1
for %%F in ("%TEMP%\sp500-verif.txt") do if %%~zF GTR 0 set QUEDA=1

rem  (b) El commit local y el del remoto son el mismo. `origin/main` es la
rem  referencia que git actualiza cuando el push entra de verdad: si el push
rem  hubiera fallado sin devolver error, estos dos no coincidirian.
for /f "tokens=*" %%A in ('git rev-parse HEAD') do set SHA_LOCAL=%%A
for /f "tokens=*" %%A in ('git rev-parse origin/!RAMA!') do set SHA_REMOTO=%%A

if "!QUEDA!"=="1" (
  echo   [AVISO] QUEDARON ARCHIVOS SIN SUBIR:
  echo.
  type "%TEMP%\sp500-verif.txt"
  echo.
  echo       Si son archivos que NO queres subir, agregalos a .gitignore.
  echo       Si te sorprende que esten ahi, volve a correr este .bat.
) else (
  echo   [ok] No quedo ningun archivo sin subir.
)

if not "!SHA_LOCAL!"=="!SHA_REMOTO!" (
  echo   [X] El commit local y el del remoto NO coinciden:
  echo          local  !SHA_LOCAL!
  echo          remoto !SHA_REMOTO!
  echo       Algo raro paso. Corre  git status  y  git log --oneline -3  a mano.
  goto :fin_error
)
echo   [ok] Local y remoto en el mismo commit: !SHA_LOCAL:~0,7!

echo.
echo ===========================================================================
echo   SUBIDO Y VERIFICADO.
echo.
echo   Vercel redeploya solo en 1 o 2 minutos. Podes mirarlo en:
echo   https://vercel.com/dashboard
echo.
echo   Hasta que el deploy termine, la web publica sigue mostrando los datos
echo   viejos. Refresca con Ctrl+F5 cuando el deploy figure como "Ready".
echo ===========================================================================
echo.
pause
endlocal
exit /b 0

:fin_ok
echo.
pause
endlocal
exit /b 0

:fin_error
echo.
echo ===========================================================================
echo   SE CORTO.
echo ===========================================================================
echo.
pause
endlocal
exit /b 1
