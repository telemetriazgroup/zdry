# ZDRY — El supermercado de contenedores

Sistema operativo de venta y alquiler de contenedores. El plan maestro está en [`proyecto_zdry.md`](proyecto_zdry.md).

**Cierre comercial (v1.1):** el cliente puede hablar con un comercial **antes de pagar** para tentar un descuento; luego paga por transferencia/interbancario y **sube el comprobante**. Un comercial valida el pago (puede demorar), informa movimientos de patio, ofrece transporte, confirma el ISO y programa el despacho. Recién ahí se empujará a **Odoo**. ZDRY **no se integra a SUNAT**.

## Arranque (Sprint 0)

```bash
cp .env.example .env
docker compose up --build
```

| Servicio | URL |
|---|---|
| Web (login + shell) | http://localhost:5173 |
| API health | http://localhost:3000/health |
| Máquina de cierre | http://localhost:3000/deal-close/machine |
| MinIO console | http://localhost:9001 |
| Mailhog | http://localhost:8025 |

Login visual: cualquier contraseña (auth real = Sprint 1). Logo: `LOGO_Z.png`.

Desarrollo frontend sin Docker de web:

```bash
cd apps/api && npm install && npm run start:dev
cd apps/web && npm install && npm run dev
```

El proxy de Vite reescribe `/api` → API en `:3000`.
# zdry
