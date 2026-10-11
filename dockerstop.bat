@echo off
echo === DOCKER COMPOSE STOP ===
docker compose down -v --remove-orphans

echo.
echo === CLEANUP DANGLING CONTAINERS ===
docker ps -a --filter "status=exited" -q | for /f %%i in ('more') do docker rm %%i 2>nul

echo.
echo === STATUS ===
docker compose ps
docker ps

echo.
echo All containers stopped and removed.
pause
