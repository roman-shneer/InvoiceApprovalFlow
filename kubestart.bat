@echo off
echo === CLEAN OLD PODS ===
kubectl delete replicaset --all --ignore-not-found
kubectl delete pod --all --grace-period=0 --force --ignore-not-found
timeout /t 5 /nobreak >nul

echo === APPLY INFRA ===
kubectl apply -f k8s\final-infrastructure.yaml
echo Waiting 20 sec for redis/mongodb/configmaps...
timeout /t 20 /nobreak >nul

echo === APPLY APPS ===
kubectl apply -f k8s\final-apps.yaml
timeout /t 5 /nobreak >nul

echo === FIX IMAGES ===
kubectl set image deployment/api-gateway api-gateway=envoyproxy/envoy:v1.36.4
kubectl set image deployment/ingestion-service app=ingestion-service:latest
kubectl set image deployment/governance-service app=governance-service:v3
kubectl set image deployment/management-service app=management-service:latest
kubectl set image deployment/payment-service app=payment-service:latest

echo === FIX ImagePullPolicy ===
kubectl patch deployment ingestion-service -p "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"app\",\"imagePullPolicy\":\"Never\"}]}}}}"
kubectl patch deployment governance-service -p "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"app\",\"imagePullPolicy\":\"Never\"}]}}}}"
kubectl patch deployment management-service -p "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"app\",\"imagePullPolicy\":\"Never\"}]}}}}"
kubectl patch deployment payment-service -p "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"app\",\"imagePullPolicy\":\"Never\"}]}}}}"
kubectl patch deployment api-gateway -p "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"api-gateway\",\"imagePullPolicy\":\"IfNotPresent\"}]}}}}"

echo === SCALE TO 1 and CLEANUP ===
kubectl scale deployment --all --replicas=1
kubectl delete replicaset --all --ignore-not-found
timeout /t 10 /nobreak >nul

echo === STATUS (should be 1/1 and 2/2 Running) ===
kubectl get pods
echo.
echo If all Running - starting port-forward
kubectl port-forward svc/api-gateway 8000:8000