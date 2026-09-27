LULA SHOP OS — ARCHITECTURE

1. PROYECTO

Lula Shop OS es el sistema de administración y punto de venta de Lula Shop.

El sistema administra:

- ventas
- POS
- inventario
- caja
- productos
- clientes
- crédito
- compras
- gastos
- pedidos
- devoluciones
- reportes
- CEO
- usuarios y permisos
- reposición

El sistema funciona para dos sucursales.

---

2. STACK

- React 19
- TypeScript
- TanStack Start / Router
- Tailwind CSS
- shadcn/radix
- Supabase JS v2
- PostgreSQL
- RLS
- XLSX

---

3. INVENTARIO

La fuente operativa de inventario es:

"shared_inventory"

El inventario es compartido entre las dos sucursales.

No existe una separación operativa del stock por sucursal.

Las ventas continúan utilizando "branchId" para identificar la sucursal correspondiente.

La tabla legacy "inventory" no debe utilizarse para reemplazar "shared_inventory".

---

4. VENTAS

El POS utiliza:

"create_sale()"

como RPC central de venta.

Métodos:

- cash
- card
- transfer
- credit
- mixed

La venta debe mantener integridad entre:

POS → venta → inventario → caja → historial.

---

5. POS

Archivo principal:

"src/components/pos/POSPanel.tsx"

Componentes relacionados:

"src/components/pos/TicketModal.tsx"

Funciones existentes importantes incluyen:

- carrito
- cantidades
- variantes
- SKU
- códigos de barras
- descuento
- nota
- métodos de pago
- crédito
- pago mixto
- cancelación
- ticket
- compartir
- inventario agregado

No eliminar estas funciones durante cambios visuales.

---

6. CAJA

Componente principal:

"src/components/cash/CashDrawerPanel.tsx"

La caja depende de las operaciones de venta y del "branchId".

No alterar su lógica para resolver problemas puramente visuales.

---

7. PERMISOS

Archivo principal:

"src/lib/permissions.ts"

Componente:

"src/components/RequireNavAccess.tsx"

Roles:

- owner
- admin
- manager
- cashier
- staff

Los permisos de UI y la seguridad backend son capas distintas.

Ocultar una opción de navegación NO sustituye RLS/autorización backend.

---

8. RUTAS PRINCIPALES

- "_shell.ajustes.tsx"
- "_shell.caja.tsx"
- "_shell.ceo.tsx"
- "_shell.clientes.tsx"
- "_shell.compras.tsx"
- "_shell.devoluciones.tsx"
- "_shell.gastos.tsx"
- "_shell.inventario.tsx"
- "_shell.pedidos.tsx"
- "_shell.productos.tsx"
- "_shell.reportes.tsx"
- "_shell.reposicion.tsx"
- "_shell.ventas.tsx"
- "_shell.tsx"

---

9. RPC IMPORTANTES

Existen operaciones relacionadas con:

- "create_sale()"
- "refund_sale"
- "transfer_stock"
- "create_online_order"
- "fulfill_online_order"
- "cancel_online_order"
- "cancel_sale(uuid,text)"

Antes de utilizar cualquier RPC nuevo:

BUSCARLO EN EL REPOSITORIO.

Nunca inventar RPCs.

---

10. ARCHIVOS PROTEGIDOS

Cambios especialmente delicados:

- POSPanel
- CashDrawerPanel
- permissions
- RequireNavAccess
- Supabase
- migrations
- RPC
- shared_inventory
- RLS

Los cambios visuales deben evitar modificar su lógica.

---

11. FLUJO GENERAL

VENTA:

Usuario
→ POS
→ validación
→ create_sale()
→ registro de venta
→ actualización correspondiente
→ inventario compartido
→ caja
→ historial
→ invalidación/refresco de datos

INVENTARIO:

Productos
→ stock compartido
→ POS consulta stock
→ venta modifica stock mediante flujo autorizado
→ POS actualiza información

PERMISOS:

Usuario
→ autenticación
→ perfil/rol
→ permisos
→ navegación
→ autorización backend/RLS

---

12. REGLA DE ARQUITECTURA

Si una modificación no está clara:

NO asumir.

Inspeccionar primero.

Si sigue existiendo duda:

detenerse antes de tocar el motor.
