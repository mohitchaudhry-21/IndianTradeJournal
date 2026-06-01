@echo off
setlocal enabledelayedexpansion

echo ================================================
echo   OptionsDesk Sync Server  v1.5.0
echo   http://localhost:5001
echo ================================================
echo.

:: Move to the folder where this bat file lives
cd /d "%~dp0"

:: Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found.
    echo Please install Python from https://python.org
    echo Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: Install / upgrade all required packages
echo Installing required packages...
pip install flask==3.0.0 flask-cors==4.0.0 requests==2.31.0 pyotp==2.9.0 --quiet --upgrade

:: Install Kotak Neo SDK if not already installed
pip show neo-api-client >nul 2>&1
if errorlevel 1 (
    echo Installing Kotak Neo API client...
    pip install neo-api-client --quiet
    if errorlevel 1 (
        echo WARNING: Could not install neo-api-client.
        echo Kotak broker sync will not be available.
        echo To fix: pip install neo-api-client
        echo.
    )
) else (
    echo Kotak Neo API client already installed.
)

echo.
echo ================================================
echo   Server running at http://localhost:5001
echo   Keep this window open while using the journal.
echo   Press Ctrl+C to stop.
echo ================================================
echo.

:: Run the server
python server.py

:: If server crashes, pause so user can see the error
if errorlevel 1 (
    echo.
    echo ERROR: Server stopped unexpectedly.
    echo Please check the error above and report it.
)
pause
