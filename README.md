# CloudMart — 5-Microservice Polyglot Persistence E-Commerce (PostgreSQL + MongoDB) for Docker & Azure AKS

Purpose-built to satisfy all mentor architecture requirements:
1. **`deployment.yaml` & `service.yaml`**: Unified Kubernetes manifests exposing the application publicly via `type: LoadBalancer` (`cloudmart-public-lb`).
2. **5 Backend Microservices** (+ Nginx Frontend Gateway):
   - `user-service` (`:3001`) — Customer Registration, Login & Session Profiles (**PostgreSQL**)
   - `catalogue-service` (`:3002`) — Product Catalogue, Categories & Search (**MongoDB**)
   - `cart-service` (`:3003`) — Stateful Customer Shopping Cart (**MongoDB**)
   - `shipping-service` (`:3004`) — Carrier Tariff Calculation & Shipment Tracking (**PostgreSQL**)
   - `order-service` (`:3005`) — Order Checkout, Invoicing & Payment Ledger (**PostgreSQL**)
3. **SQL / PostgreSQL Backend**: `postgres:16-alpine` (`postgres-db:5432`) storing `users`, `orders`, and `shipments` tables.
4. **MongoDB NoSQL Backend**: `mongo:7.0` (`mongo-db:27017`) storing `products` and `carts` collections.

## Run Locally with Docker Compose
```bash
docker compose up --build -d
docker compose ps
```
Then open `http://localhost:8080`.

## Deploy to Kubernetes / Azure AKS
```bash
export ACR_LOGIN_SERVER=<your-acr-name>.azurecr.io
envsubst < deployment.yaml | kubectl apply -f -
kubectl apply -f service.yaml
kubectl get pods,svc -n cloudmart-ecommerce
```
