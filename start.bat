@echo off
echo.
echo ========================================================
echo   Starting Stablecoin Yield Dashboard
echo ========================================================
echo.
echo This will start the backend server which provides 150+
echo yield opportunities from Morpho, Euler, and other DeFi
echo protocols.
echo.
echo --------------------------------------------------------
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting server...
echo.
echo Once started, open your browser to:
echo http://localhost:3000
echo.
echo You should see 150-200 yield opportunities!
echo.
echo --------------------------------------------------------
echo.

node server.js
