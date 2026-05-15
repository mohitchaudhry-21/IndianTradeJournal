@echo off
echo ================================================
echo   OptionsDesk — Indian Market Journal
echo ================================================
echo.

:: Start sync server in background
start "OptionsDesk Sync Server" cmd /k "cd /d %~dp0sync-server && python server.py"

:: Install npm packages if needed
echo Checking packages...
call npm install --prefix "%~dp0" --silent 2>nul

echo.
echo Starting journal...
start "OptionsDesk Journal" cmd /k "cd /d %~dp0 && npm start"

echo.
echo ================================================
echo   Journal will open in your browser shortly.
echo   Keep both windows open while trading.
echo ================================================
timeout /t 4 /nobreak >nul
