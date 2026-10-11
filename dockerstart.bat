@echo off
echo === CHECK .env ===
if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env"
    echo Created .env from .env.example
  ) else (
    echo ERROR: .env.example not found!
  )
) else (
  echo .env exists - skipping
)

echo === CHECK dapr\secrets.json ===
if not exist "dapr\secrets.json" (
  if exist "dapr\secrets.json.example" (
    copy /Y "dapr\secrets.json.example" "dapr\secrets.json"
    echo Created dapr\secrets.json
  ) else (
    echo WARNING: dapr\secrets.json.example not found
  )
) else (
  echo dapr\secrets.json exists - skipping
)

echo === CHECK k8s\secrets.yaml ===
if not exist "k8s\secrets.yaml" (
  if exist "k8s\secrets.yaml.template" (
    copy /Y "k8s\secrets.yaml.template" "k8s\secrets.yaml"
    echo Created k8s\secrets.yaml
  ) else (
    echo WARNING: k8s\secrets.yaml.template not found
  )
) else (
  echo k8s\secrets.yaml exists - skipping
)

echo.
echo === DOCKER COMPOSE UP ===
docker compose down
docker compose up --build -d

echo.
echo === STATUS ===
docker compose ps

echo.
echo Waiting 10 sec for services...
timeout /t 10 /nobreak >nul

docker compose logs --tail=50

echo.
echo Done! Gateway: http://localhost:8000
pause
