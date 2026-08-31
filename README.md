# ZDRY — El supermercado de contenedores

Sistema operativo de venta y alquiler de contenedores. Plan: [`proyecto_zdry.md`](proyecto_zdry.md).

**Cierre comercial:** comprobante + validación humana → Odoo. Sin SUNAT ni pasarela.

## Arranque

```bash
cp .env.example .env
docker compose up --build
```

| Servicio | URL |
|---|---|
| Web | http://localhost:28080/zdry/ |
| API (vía app) | http://localhost:28080/zdry/api/health |
| API directa | http://localhost:3003/health |
| Postgres (host) | localhost:5435 |
| MinIO | http://localhost:9001 |
| Mailhog | http://localhost:8025 |

## Usuarios Sprint 1 (clave `Zdry123!`)

| Correo | Rol |
|---|---|
| admin@zdry.pe | Administrador Total |
| gerente@zdry.pe | Gerente de Ventas |
| vendedor@zdry.pe | Vendedor / Comercial |
| compras@zdry.pe | Compras / Costos |
| almacen@zdry.pe | Almacén / Operador |

Cada cuenta ve un menú distinto. El vendedor **no recibe** FOB ni C_T en `/zdry/api/inventory/sample`. Configuración responde **403** si no eres admin o gerente.

Desarrollo local:

```bash
cd apps/api && npm install && npx prisma generate && npm run start:dev
cd apps/web && npm install && npm run dev
```
