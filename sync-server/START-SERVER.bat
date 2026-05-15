@echo off
echo ================================================
echo   OptionsDesk Sync Server
echo   Starting...
echo ================================================
echo.

:: Install requirements
echo Installing Python packages...
pip install -r "%~dp0requirements.txt" --quiet

echo.
echo Starting server on http://localhost:5001
echo Keep this window open while using the journal.
echo.

python "%~dp0server.py"
pause
