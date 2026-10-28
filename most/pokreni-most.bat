@echo off
rem Pokrece ECON most (XRechnung). Prozor ostaje otvoren i ispisuje sto se događa; zatvaranjem prozora most staje.
cd /d "%~dp0"
title ECON most
node most.js
pause
