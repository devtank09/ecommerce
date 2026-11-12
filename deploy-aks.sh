#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-cloudmart-aks}"
LOCATION="${LOCATION:-centralindia}"
ACR_NAME="${ACR_NAME:-acrcloudmart$RANDOM}"
AKS_CLUSTER="${AKS_CLUSTER:-aks-cloudmart-cluster}"
IMAGE_TAG="${IMAGE_TAG:-v2.0.0}"

echo "==> [1/6] Creating Azure Resource Group: $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

echo "==> [2/6] Creating Azure Container Registry (ACR): $ACR_NAME"
az acr create --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --sku Basic
export ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)

echo "==> [3/6] Building & Pushing All 5 Microservices + Frontend Gateway to ACR"
az acr login --name "$ACR_NAME"

for svc in user-service catalogue-service cart-service shipping-service order-service; do
  docker build -t "$ACR_LOGIN_SERVER/cloudmart/$svc:$IMAGE_TAG" "./$svc"
  docker push "$ACR_LOGIN_SERVER/cloudmart/$svc:$IMAGE_TAG"
done

docker build -t "$ACR_LOGIN_SERVER/cloudmart/frontend-gateway:$IMAGE_TAG" "./frontend"
docker push "$ACR_LOGIN_SERVER/cloudmart/frontend-gateway:$IMAGE_TAG"

echo "==> [4/6] Creating Azure Kubernetes Service (AKS) Cluster with Standard LoadBalancer"
az aks create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$AKS_CLUSTER" \
  --node-count 2 \
  --node-vm-size Standard_B2s \
  --network-plugin azure \
  --load-balancer-sku standard \
  --attach-acr "$ACR_NAME" \
  --generate-ssh-keys

echo "==> [5/6] Applying deployment.yaml and service.yaml"
az aks get-credentials --resource-group "$RESOURCE_GROUP" --name "$AKS_CLUSTER" --overwrite-existing
envsubst < deployment.yaml | kubectl apply -f -
kubectl apply -f service.yaml

echo "==> [6/6] Waiting for Azure Public LoadBalancer IP on service/cloudmart-public-lb..."
kubectl get pods -n cloudmart-ecommerce -o wide
kubectl get svc cloudmart-public-lb -n cloudmart-ecommerce -w
