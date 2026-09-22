LULA SHOP OS — CHANGELOG AI

PROPÓSITO

Este archivo registra los cambios realizados por cada sesión o cuenta de IA.

NO borrar entradas anteriores.

Cada sesión debe agregar una nueva entrada al final.

---

2026-09-22 — SESIONES INICIALES

F0 — AUDITORÍA

Arquitectura confirmada

- React 19
- TanStack Start/Router
- TypeScript
- Tailwind v4
- shadcn/radix
- Supabase JS v2
- PostgreSQL
- RLS
- xlsx

Módulos existentes

- Caja/POS
- Ventas
- Productos
- Inventario
- Compras
- Clientes
- Devoluciones
- Gastos
- Pedidos
- Reportes
- CEO
- Ajustes
- Auth

Componentes importantes

- "POSPanel.tsx"
- "CashDrawerPanel.tsx"
- "ImportExportPanel.tsx"
- "TicketModal.tsx"

Inventario

Se confirmó que el inventario debe mantenerse compartido entre las dos sucursales.

No se modificó esta arquitectura.

---

F0 — SEGURIDAD

Se detectaron políticas RLS permisivas antiguas en:

- "expenses"
- "credit_payments"

Migration creada:

"supabase/migrations/20260922180000_fix_permissive_rls_expenses_credit_payments.sql"

Estado:

PENDIENTE DE EJECUTAR EN SUPABASE.

---

RPCS HUÉRFANAS DETECTADAS

Funciones conocidas en la base viva pero sin cuerpo local conocido:

- "refund_sale"
- "transfer_stock"
- "create_online_order"
- "fulfill_online_order"
- "cancel_online_order"

No se inventaron.

---

2026-09-22 — F1

NAVEGACIÓN MÓVIL

Modificado:

"src/routes/_shell.tsx"

Implementado:

- sidebar solo escritorio;
- navegación inferior móvil;
- Caja;
- Ventas;
- Inventario;
- Clientes;
- Más;
- selector de sucursal;
- logout;
- padding inferior móvil.

No se crearon componentes separados porque la navegación ya estaba integrada.

---

2026-09-22 — F2

PROTECCIÓN REAL DE RUTAS

Creado:

"src/components/RequireNavAccess.tsx"

Utiliza:

- "canAccess()";
- "NavKey".

desde:

"src/lib/permissions.ts".

Se aplicó a las 12 rutas protegidas.

Objetivo:

Que ocultar enlaces del menú no sea la única protección.

Un usuario sin permiso no debe poder cargar directamente una página mediante URL.

---

CHECKPOINT ACTUAL

F0

TERMINADA, salvo migration de seguridad pendiente de ejecutar.

F1

TERMINADA.

F2

TERMINADA en protección de rutas.

F3

SIGUIENTE.

---

F3 — POS

Primera acción obligatoria

NO modificar inmediatamente "POSPanel.tsx".

Primero:

1. leer "POSPanel.tsx" completo;
2. leer "TicketModal.tsx" completo;
3. revisar hooks;
4. revisar queries;
5. revisar mutations;
6. revisar RPCs;
7. revisar tipos;
8. identificar funciones existentes;
9. comparar con los objetivos de POS de "PROJECT_CONTEXT.md".

Después implementar únicamente lo que realmente falte.

---

2026-09-22 — F3 (Claude, sesión de auditoría + POS)

POS — CORRECCIÓN DE CAMPOS SIN UI Y SELECTOR DE VARIANTES

Modificado:
"src/components/pos/POSPanel.tsx"
"src/components/pos/TicketModal.tsx"

Implementado:
- Input de descuento a nivel ticket (existía el estado, no el campo).
- Input de nota de venta (existía el estado, no el campo).
- Selector de variantes para productos con has_variants=true, usando la tabla real "product_variants" e "inventory.variant_id".
- Stock agregado por producto (suma de variantes) en la tarjeta de la grilla.
- Botón "Compartir" en el ticket (Web Share API / WhatsApp).

No se tocó: create_sale RPC, esquema de base de datos, protección de rutas, navegación, caja, ni ningún otro módulo.

Validación pendiente: sin acceso a red en esta sesión para instalar dependencias, no se ejecutó tsc/build. Revisar antes de desplegar.

Bloqueo detectado: cancelación/anulación de venta en el mismo turno requiere conocer el cuerpo real de "refund_sale" o definir una RPC nueva — no implementado, documentado en IMPLEMENTATION_PROGRESS.md.

---

REGLA DE TODAS LAS SESIONES FUTURAS

Cada sesión debe:

1. leer el contexto;
2. leer el progreso;
3. revisar el código;
4. continuar desde el checkpoint;
5. implementar;
6. validar;
7. actualizar "IMPLEMENTATION_PROGRESS.md";
8. agregar una entrada aquí.

Nunca borrar historial.