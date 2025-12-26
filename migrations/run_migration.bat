@echo off
REM ============================================
REM PRODUCTION DATABASE MIGRATION SCRIPT (Windows)
REM Run this to fix tracking errors
REM ============================================

echo ========================================
echo DATABASE MIGRATION - FIX TRACKING COLUMNS
echo ========================================
echo.

REM Set default values
set DB_HOST=localhost
set DB_USER=root
set DB_NAME=food_delivery

REM Check if running in XAMPP environment
if exist "C:\xampp\mysql\bin\mysql.exe" (
    set MYSQL_PATH=C:\xampp\mysql\bin\mysql.exe
) else (
    set MYSQL_PATH=mysql
)

echo Database: %DB_NAME%
echo Host: %DB_HOST%
echo User: %DB_USER%
echo.

REM Prompt for password
set /p DB_PASS="Enter MySQL password: "

echo.
echo Running migration...
echo.

REM Run the migration
"%MYSQL_PATH%" -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% < fix_tracking_columns.sql

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo MIGRATION COMPLETED SUCCESSFULLY!
    echo ========================================
    echo.
    echo Verifying columns...
    echo.
    
    "%MYSQL_PATH%" -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SHOW COLUMNS FROM restaurants LIKE 'lat';"
    "%MYSQL_PATH%" -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SHOW COLUMNS FROM agents LIKE 'lat';"
    "%MYSQL_PATH%" -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SHOW COLUMNS FROM agents LIKE 'is_online';"
    
    echo.
    echo ========================================
    echo NEXT STEPS:
    echo ========================================
    echo 1. Restart your backend server (node server.js)
    echo 2. Test tracking endpoint
    echo 3. Verify no more errors
    echo.
    
) else (
    echo.
    echo ========================================
    echo MIGRATION FAILED!
    echo ========================================
    echo.
    echo Please check:
    echo - Database credentials are correct
    echo - MySQL service is running
    echo - You have ALTER TABLE permissions
    echo.
)

pause
