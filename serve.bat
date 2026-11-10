@echo off
rem Maleda: start a fast local server on http://127.0.0.1:8765/ and open it in the browser
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 serve.py %*) else (python serve.py %*)
