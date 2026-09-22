LULA SHOP OS — PROJECT CONTEXT

DOCUMENTO MAESTRO DEL PROYECTO

Este archivo contiene el contexto permanente de Lula Shop OS.

Cualquier IA que trabaje sobre este repositorio DEBE leer este archivo antes de modificar código.

---

1. OBJETIVO PRINCIPAL

Lula Shop OS es el sistema operativo empresarial propio de Lula Shop.

El objetivo es construir un sistema integral de gestión para las dos sucursales de Lula Shop que sea:

- completo;
- profesional;
- escalable;
- rápido;
- responsive;
- seguro;
- fácil de utilizar;
- preparado para crecer;
- preparado para incorporar IA posteriormente.

El sistema debe llegar a ser funcionalmente muy cercano a Zobaze POS, tanto en los flujos principales como en la experiencia de uso.

La intención es que una persona acostumbrada a Zobaze pueda utilizar Lula Shop OS prácticamente sin curva de aprendizaje.

Esto significa que no se busca solamente copiar algunas funciones de un POS.

Se busca alcanzar una paridad funcional y de experiencia de usuario muy alta, manteniendo una implementación propia.

---

2. IMPORTANTE — ZOBAZE

Zobaze se utiliza como referencia funcional y de experiencia.

Lula Shop OS debe buscar tener equivalentes propios de las funciones relevantes de Zobaze, incluyendo:

- POS;
- ventas;
- carrito;
- productos;
- variantes;
- códigos de barras;
- clientes;
- crédito;
- pagos;
- pagos divididos;
- descuentos;
- tickets;
- impresión;
- compartir tickets;
- reimpresión;
- inventario;
- compras;
- proveedores;
- gastos;
- caja;
- devoluciones;
- pedidos;
- reportes;
- estadísticas;
- funcionamiento móvil;
- funcionamiento en tablet;
- funcionamiento en escritorio.

NO copiar:

- código propietario;
- logos;
- identidad visual protegida;
- imágenes propietarias;
- assets propietarios;
- código interno;
- implementaciones propietarias.

La implementación de Lula Shop OS debe ser propia.

La experiencia debe ser familiar para usuarios de Zobaze.

---

3. REGLA FUNDAMENTAL

EL PROYECTO YA EXISTE.

NO comenzar desde cero.

NO reconstruir toda la aplicación.

NO cambiar de framework.

NO reemplazar módulos funcionales simplemente para hacerlos "más limpios".

NO borrar funcionalidades existentes.

La estrategia es:

AUDITAR
→ ENTENDER
→ EXTENDER
→ INTEGRAR
→ VALIDAR
→ DOCUMENTAR

---

4. INVENTARIO — REGLA ABSOLUTA

Lula Shop tiene DOS sucursales.

El inventario debe permanecer COMPARTIDO.

NO convertirlo en dos inventarios completamente independientes.

La arquitectura actual debe respetarse.

Actualmente:

- "inventory" maneja "branch_id";
- "products" es global;
- "categories" es global;
- "customers" es global;
- "suppliers" es global.

Antes de modificar cualquier función de inventario, estudiar la implementación actual.

Cualquier nueva función debe mantener la lógica existente.

---

5. SISTEMA COMPLETO QUE SE QUIERE CONSTRUIR

Lula Shop OS debe terminar integrando:

POS

Productos

Inventario

Compras

Proveedores

Clientes

Crédito

Caja

Gastos

Devoluciones

Pedidos

Tienda en línea

Reportes

CEO

Personal y roles

Futuro asistente IA empresarial

Todos deben formar parte de un solo sistema coherente.

---

6. POS — OBJETIVO DE PARIDAD

El POS debe acercarse funcionalmente a Zobaze.

Debe contemplar:

- búsqueda rápida;
- búsqueda por nombre;
- búsqueda por SKU;
- búsqueda por código de barras;
- escaneo mediante cámara cuando sea compatible;
- selección de productos;
- carrito;
- cantidades;
- modificación de cantidades;
- eliminación;
- variantes;
- productos agotados;
- control de stock;
- descuentos;
- descuentos por producto;
- descuentos en venta cuando corresponda;
- selección de cliente;
- venta normal;
- venta a crédito;
- efectivo;
- tarjeta;
- transferencia;
- otros métodos;
- pagos divididos;
- cálculo de cambio;
- notas;
- ticket;
- impresión;
- ticket digital;
- compartir ticket;
- reimpresión;
- cancelación;
- devolución;
- permisos;
- historial;
- ventas rápidas.

Debe funcionar correctamente en:

- teléfono;
- tablet;
- computadora.

---

7. PRODUCTOS

El módulo de productos debe soportar, según la arquitectura existente:

- nombre;
- SKU;
- código de barras;
- imágenes;
- precio;
- costo;
- margen;
- categoría;
- stock mínimo;
- variantes;
- estado;
- información para POS;
- información para inventario;
- información para compras.

No duplicar catálogos.

---

8. INVENTARIO

El inventario debe ser robusto.

Debe contemplar:

- existencia;
- movimientos;
- entradas;
- salidas;
- ajustes;
- transferencias;
- mínimos;
- faltantes;
- pérdidas;
- diferencias;
- inventario físico;
- conteos;
- historial;
- valor del inventario;
- alertas;
- productos agotados;
- compras sugeridas.

El inventario físico debe permitir comparar:

EXISTENCIA DEL SISTEMA
vs.
CONTEO FÍSICO

y mostrar:

- faltante en unidades;
- faltante en dinero;
- diferencias;
- historial.

NO sustituir el inventario robusto existente por un inventario básico.

---

9. COMPRAS

Debe contemplar:

- proveedores;
- compras;
- productos;
- cantidades;
- costos;
- recepción;
- recepción parcial cuando corresponda;
- actualización de inventario;
- historial;
- compras sugeridas;
- reposición.

Debe reutilizar la lógica existente de inventario.

---

10. CLIENTES

Debe contemplar:

- clientes globales;
- nombre;
- teléfono;
- correo cuando corresponda;
- historial;
- compras;
- crédito;
- saldo;
- pagos;
- abonos;
- acciones rápidas;
- relación con pedidos.

---

11. CRÉDITO

Debe contemplar:

- venta a crédito;
- saldo;
- abonos;
- pagos;
- historial;
- estado;
- cliente relacionado;
- permisos.

Las operaciones deben estar protegidas también mediante backend/RLS/RPC cuando corresponda.

---

12. CAJA

Debe contemplar:

- apertura;
- cierre;
- arqueo;
- movimientos;
- ingresos;
- egresos;
- efectivo;
- diferencias;
- historial;
- relación con ventas.

No reemplazar la lógica actual sin auditarla.

---

13. GASTOS

Debe contemplar:

- gastos;
- categorías;
- cantidades;
- fechas;
- usuarios;
- sucursal;
- reportes;
- permisos.

La seguridad debe existir realmente en Supabase/RLS, no solamente en la interfaz.

---

14. DEVOLUCIONES

Debe contemplar:

- devolución parcial;
- devolución completa;
- motivo;
- producto;
- cantidad;
- ajuste de inventario;
- ajuste monetario;
- relación con venta;
- permisos;
- historial.

Si existe una RPC o lógica funcional para devoluciones, reutilizarla.

NO inventar una segunda lógica paralela.

---

15. PEDIDOS EN LÍNEA

El sistema debe poder manejar pedidos en línea.

Estados conocidos:

- "pending"
- "confirmed"
- "preparing"
- "ready"
- "delivered"
- "cancelled"

Debe existir coherencia entre:

PEDIDO
→ PRODUCTOS
→ INVENTARIO
→ PAGO
→ PREPARACIÓN
→ ENTREGA

---

16. TIENDA EN LÍNEA

La arquitectura debe quedar preparada para una tienda en línea integrada al sistema.

Debe poder evolucionar hacia:

- catálogo;
- productos;
- variantes;
- stock;
- carrito;
- clientes;
- pedidos;
- pagos;
- estados;
- preparación;
- entrega;
- sincronización con inventario.

---

17. REPORTES

Objetivo:

- ventas;
- utilidad;
- margen;
- ticket promedio;
- productos vendidos;
- inventario;
- faltantes;
- pérdidas;
- gastos;
- caja;
- crédito;
- clientes;
- tendencias;
- comparaciones;
- metas.

---

18. CEO

El módulo CEO debe evolucionar hacia el centro de inteligencia empresarial.

Debe poder mostrar cuando los datos estén disponibles:

- ventas de hoy;
- ventas de ayer;
- ventas del mes;
- comparación con periodo anterior;
- comparación con mismo periodo anterior;
- utilidad;
- margen;
- ticket promedio;
- clientes;
- productos vendidos;
- productos agotados;
- inventario;
- valor del inventario;
- flujo de efectivo;
- gastos;
- crédito;
- metas;
- avance;
- tendencias;
- alertas.

Posteriormente podrá integrarse una IA para analizar los datos reales.

Ejemplos:

- qué hacer hoy;
- qué comprar;
- qué promocionar;
- qué productos rotan más;
- qué productos rotan menos;
- dónde se está perdiendo dinero;
- qué productos están agotados;
- qué sucursal necesita atención;
- cómo va la meta;
- qué acciones podrían mejorar el resultado.

La IA futura debe utilizar datos reales del sistema.

---

19. PERSONAL Y ROLES

Roles objetivo:

- owner;
- admin;
- manager;
- cashier;
- staff.

Jerarquía:

owner

«»

admin

«»

manager

«»

cashier

«»

staff

No permitir autoasignación de owner.

Proteger al último owner.

Los permisos deben aplicarse tanto en interfaz como en backend/RLS/RPC cuando corresponda.

---

20. SEGURIDAD

Reglas:

- no inventar RLS;
- no inventar RPCs;
- no inventar tablas;
- no inventar columnas;
- no inventar enums;
- no borrar políticas sin verificar;
- revisar políticas existentes antes de crear nuevas;
- recordar que las políticas permisivas de PostgreSQL se combinan con OR;
- validar permisos sensibles en backend/RLS;
- no depender solamente de ocultar botones;
- no permitir acceso no autorizado por URL;
- no permitir que usuarios normales se conviertan en owner.

---

21. RPCS CONOCIDAS

Actualmente se sabe que existen en la base viva:

- "refund_sale"
- "transfer_stock"
- "create_online_order"
- "fulfill_online_order"
- "cancel_online_order"

Pero sus cuerpos no están en las migrations locales conocidas.

NO inventar sus cuerpos.

Si alguna necesita modificarse:

1. obtener definición real;
2. documentarla;
3. agregarla correctamente al control de versiones;
4. comprobar compatibilidad;
5. validar.

---

22. STACK

Confirmado:

- React 19;
- TanStack Start;
- TanStack Router;
- TypeScript;
- Tailwind v4;
- shadcn/radix;
- Supabase JS v2;
- PostgreSQL;
- RLS;
- xlsx.

---

23. RUTAS PRINCIPALES

- "src/routes/_shell.tsx"
- "src/routes/_shell.ajustes.tsx"
- "src/routes/_shell.ceo.tsx"
- "src/routes/_shell.devoluciones.tsx"
- "src/routes/_shell.gastos.tsx"
- "src/routes/_shell.compras.tsx"
- "src/routes/_shell.pedidos.tsx"
- "src/routes/_shell.reportes.tsx"
- "src/routes/_shell.clientes.tsx"
- "src/routes/_shell.productos.tsx"
- "src/routes/_shell.inventario.tsx"
- "src/routes/_shell.ventas.tsx"
- "src/routes/_shell.caja.tsx"

---

24. COMPONENTES IMPORTANTES

- "src/components/POSPanel.tsx"
- "src/components/TicketModal.tsx"
- "src/components/CashDrawerPanel.tsx"
- "src/components/ImportExportPanel.tsx"
- "src/components/RequireNavAccess.tsx"

---

25. PROTECCIÓN DE RUTAS

Existe:

"src/components/RequireNavAccess.tsx"

Utiliza:

"canAccess()"

y:

"NavKey"

desde:

"src/lib/permissions.ts".

NO eliminar esta protección.

---

26. RESPONSIVE

El sistema debe ser realmente usable en:

- teléfono;
- tablet;
- escritorio.

Especial atención:

- POS;
- carrito;
- búsqueda;
- teclado;
- navegación;
- inventario;
- tickets;
- formularios;
- tablas.

---

27. REGLAS PARA CUALQUIER IA

Antes de trabajar:

1. leer "PROJECT_CONTEXT.md";
2. leer "IMPLEMENTATION_PROGRESS.md";
3. leer "CHANGELOG_AI.md";
4. leer "AI_CONTINUATION.md";
5. revisar código real.

Después:

1. identificar fase;
2. identificar checkpoint;
3. revisar archivos reales;
4. implementar;
5. validar;
6. actualizar documentación.

NO repetir trabajo ya terminado.

NO comenzar desde cero.

NO borrar trabajo anterior.

---

28. REGLA DE FUENTE DE VERDAD

El código real determina qué existe.

"PROJECT_CONTEXT.md" determina qué se quiere construir y qué reglas son permanentes.

"IMPLEMENTATION_PROGRESS.md" determina dónde está el desarrollo.

"CHANGELOG_AI.md" registra qué hizo cada sesión.

"AI_CONTINUATION.md" determina cómo debe continuar una IA.

Si existe contradicción:

CÓDIGO REAL
→ investigar
→ corregir documentación
→ continuar.

---

29. OBJETIVO FINAL

Lula Shop OS debe convertirse en el núcleo central de Lula Shop.

Debe integrar:

POS
+
INVENTARIO
+
COMPRAS
+
CLIENTES
+
CRÉDITO
+
CAJA
+
GASTOS
+
DEVOLUCIONES
+
PEDIDOS
+
TIENDA EN LÍNEA
+
REPORTES
+
CEO
+
IA EMPRESARIAL

El sistema debe sentirse como una solución profesional y, funcionalmente, muy cercana a Zobaze, pero construida con tecnología y código propios.

La evolución debe ser incremental.

NO reiniciar.

NO romper.

NO perder contexto.

NO perder funcionalidades.

NO perder el inventario compartido.