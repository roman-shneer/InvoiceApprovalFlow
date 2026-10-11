@echo off
echo Stopping all...
kubectl scale deployment --all --replicas=0
kubectl delete pod --all --grace-period=0 --force
kubectl delete replicaset --all
echo Done. PC freed.
pause