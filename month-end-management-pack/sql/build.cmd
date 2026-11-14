@echo off
rem Builds AshcombeFinance from the CSV files in ..\data. Usage: build.cmd [server], localhost by default.
setlocal
set "SERVER=localhost"
if not "%~1"=="" set "SERVER=%~1"
set "DATABASE=AshcombeFinance"
set "HERE=%~dp0"

sqlcmd -S "%SERVER%" -E -b -Q "IF DB_ID('%DATABASE%') IS NOT NULL BEGIN ALTER DATABASE [%DATABASE%] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [%DATABASE%]; END; CREATE DATABASE [%DATABASE%];" || exit /b 1
sqlcmd -S "%SERVER%" -E -b -d "%DATABASE%" -i "%HERE%01-tables.sql" || exit /b 1
sqlcmd -S "%SERVER%" -E -b -d "%DATABASE%" -i "%HERE%02-load.sql" -v DataPath="%HERE%..\data" || exit /b 1
sqlcmd -S "%SERVER%" -E -b -d "%DATABASE%" -i "%HERE%03-views.sql" || exit /b 1
sqlcmd -S "%SERVER%" -E -b -d "%DATABASE%" -W -Q "SET NOCOUNT ON; SELECT (SELECT COUNT(*) FROM erp.JournalLine) AS extracted_lines, (SELECT COUNT(*) FROM rpt.JournalLine) AS reporting_lines, (SELECT COUNT(*) FROM rpt.DuplicateLine) AS duplicates_removed;"
