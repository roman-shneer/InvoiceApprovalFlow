@echo off
echo === COPY .env ===
if not exist ".env" (
  copy /Y ".env.example" ".env"
  echo Created .env
) else (
  echo .env exists - skipping
)

echo === COPY dapr\secrets.json ===
if not exist "dapr\secrets.json" (
  copy /Y "dapr\secrets.json.example" "dapr\secrets.json"
  echo Created dapr\secrets.json
) else (
  echo dapr\secrets.json exists - skipping
)

echo === COPY k8s\secrets.yaml ===
if not exist "k8s\secrets.yaml" (
  copy /Y "k8s\secrets.yaml.template" "k8s\secrets.yaml"
  echo Created k8s\secrets.yaml from template
) else (
  echo k8s\secrets.yaml exists - skipping
)