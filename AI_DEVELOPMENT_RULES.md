LULA SHOP OS — REGLAS OBLIGATORIAS PARA IA

1. PROPÓSITO

Lula Shop OS es un sistema de operación empresarial.

El código existente contiene lógica de negocio, ventas, inventario, caja, clientes, permisos y conexión con Supabase.

La prioridad absoluta es:

«NO ROMPER FUNCIONALIDAD EXISTENTE.»

Toda IA que modifique este repositorio debe leer este archivo antes de realizar cambios.

---

2. REGLA PRINCIPAL

CAMBIOS VISUALES = MOTOR CONGELADO

Cuando el usuario solicite un cambio visual, la IA solamente puede modificar la interfaz.

No debe modificar lógica de negocio, base de datos, RPCs, permisos ni arquitectura.

Si para conseguir el cambio visual considera necesario modificar lógica, debe DETENERSE y explicarlo antes de hacerlo.

No tiene autorización implícita.

---

3. CAPAS DEL SISTEMA

CAPA PROTEGIDA — MOTOR

Se considera protegida:

- Supabase
- PostgreSQL
- RPCs
- "create_sale()"
- "shared_inventory"
- inventario
- stock
- movimientos de inventario
- ventas
- cancelaciones
- devoluciones
- caja
- arqueos
- clientes
- crédito
- pagos
- descuentos
- permisos
- roles
- autenticación
- RLS
- queries
- mutations
- cálculos financieros
- reportes
- sincronización
- React Query
- invalidaciones de datos

No modificar esta capa durante cambios visuales.

---

4. CAPA VISUAL

Los siguientes elementos pueden modificarse cuando el usuario solicite cambios visuales:

- colores
- tipografía
- tamaños
- márgenes
- padding
- bordes
- sombras
- iconos
- botones
- tarjetas
- tablas
- distribución
- responsive
- layouts
- estados visuales
- animaciones
- textos de interfaz
- apariencia móvil
- apariencia tablet
- apariencia escritorio

Siempre que el cambio pueda realizarse sin alterar la lógica.

---

5. PROHIBICIONES

Una IA NO debe modificar por iniciativa propia:

- tablas de Supabase
- columnas
- relaciones
- RPCs
- RLS
- políticas
- autenticación
- roles
- permisos
- "create_sale()"
- "shared_inventory"
- lógica de stock
- lógica de caja
- lógica de ventas
- cálculos financieros
- queries
- mutations
- APIs
- dependencias
- versiones de paquetes
- arquitectura
- rutas
- componentes funcionales
- estructuras de datos

salvo autorización explícita del usuario.

---

6. CAMBIOS MÍNIMOS

La IA debe modificar la menor cantidad de código posible.

Si un cambio puede realizarse modificando CSS/Tailwind, no debe modificar lógica React.

Si un componente existente funciona, no debe reemplazarlo innecesariamente.

No reescribir archivos completos para cambios pequeños.

No hacer refactorizaciones no solicitadas.

No "limpiar" código que no sea necesario para la tarea.

---

7. NO HACER MEJORAS NO SOLICITADAS

La IA debe trabajar exclusivamente sobre el objetivo solicitado.

No agregar:

- nuevas funciones
- nuevas pantallas
- nuevas tablas
- nuevas RPCs
- nuevas dependencias
- nuevos flujos
- nuevas reglas de negocio

sin autorización explícita.

---

8. CAMBIOS DE MOTOR

Si el usuario solicita explícitamente modificar el motor, la IA debe identificar primero:

1. Archivos afectados.
2. Funciones afectadas.
3. Datos afectados.
4. Riesgos.
5. Dependencias.
6. Posibles regresiones.

No debe asumir autorización para modificar otras áreas.

---

9. INVENTARIO

El inventario operativo utiliza:

"shared_inventory"

No sustituirlo por la tabla legacy "inventory".

Las ventas deben continuar utilizando el flujo existente.

"create_sale()" permanece como RPC central de venta salvo autorización explícita.

---

10. VENTAS

Antes de modificar cualquier código relacionado con ventas verificar:

- método de pago
- efectivo
- tarjeta
- transferencia
- crédito
- mixto
- descuentos
- cliente
- caja
- inventario
- folio
- ticket
- cancelación
- invalidaciones de React Query

Una modificación visual no debe alterar ninguno de estos comportamientos.

---

11. CAJA

No modificar por iniciativa propia:

- apertura
- cierre
- arqueo
- movimientos
- efectivo
- sesiones de caja
- relación entre venta y caja

durante cambios visuales.

---

12. PERMISOS Y SEGURIDAD

No modificar:

- RLS
- políticas
- roles
- autenticación
- autorización
- "canAccess"
- permisos de usuario

durante cambios visuales.

La seguridad debe permanecer en backend/RLS cuando corresponda.

---

13. REACT QUERY

No eliminar ni modificar invalidaciones existentes solamente para realizar cambios visuales.

Después de una operación de datos deben mantenerse las invalidaciones necesarias.

---

14. VALIDACIÓN OBLIGATORIA

Después de cada cambio:

1. Revisar los archivos modificados.
2. Confirmar que no se eliminó lógica existente.
3. Confirmar que no cambiaron RPCs.
4. Confirmar que no cambiaron consultas críticas.
5. Confirmar que no cambiaron nombres de campos.
6. Ejecutar TypeScript/build si está disponible.
7. Corregir errores provocados por el cambio.
8. No corregir problemas ajenos a la tarea sin autorización.

---

15. COMMITS

Los cambios deben mantenerse separados.

Ejemplos:

"ui: mejora visual POS"

"fix: corregir método de pago"

"inventory: actualizar flujo de stock"

No mezclar cambios visuales con cambios de motor en el mismo commit.

Antes de cambios importantes debe existir un checkpoint/commit para poder revertir.

---

16. REGLA DE SEGURIDAD ANTE DUDAS

Si no está claro si una modificación afecta al motor:

«DETENERSE.»

No asumir.

No modificar.

Explicar qué parte podría verse afectada y esperar autorización.

---

17. PRIORIDAD

En caso de conflicto entre mejorar la interfaz y conservar funcionalidad:

CONSERVAR FUNCIONALIDAD.

Orden de prioridad:

1. Integridad de datos.
2. Ventas.
3. Inventario.
4. Caja.
5. Seguridad.
6. Permisos.
7. Funcionalidad existente.
8. Diseño visual.
9. Mejoras adicionales.

---

18. PRINCIPIO FUNDAMENTAL

Lula Shop OS tiene un motor funcional que debe tratarse como infraestructura crítica.

Las IAs están autorizadas a mejorar la interfaz, pero no deben asumir que pueden modificar el motor para conseguir un resultado visual.

FRASE DE CONTROL

Cuando el usuario diga:

"CAMBIO VISUAL"

interpretar automáticamente:

«MOTOR CONGELADO. CAMBIAR SOLAMENTE UI/UX.»

Cuando el usuario diga:

"CAMBIO DE MOTOR"

entonces analizar la lógica correspondiente antes de modificarla.

---

19. REGLA FINAL

No importa qué tan pequeña parezca una modificación:

«NO ROMPER LO QUE YA FUNCIONA.»

Preservar primero. Mejorar después.