LULA SHOP OS — PROJECT STATUS

ESTADO ACTUAL

Proyecto: Lula Shop OS / Pixel Perfect

Objetivo:

Construir un sistema completo de administración y POS para Lula Shop con una experiencia comparable a Zobaze, manteniendo arquitectura, datos y lógica propios.

---

MOTOR PRINCIPAL

Ventas

Estado: FUNCIONAL

"create_sale()" continúa siendo el RPC central.

Inventario

Estado: FUNCIONAL

Fuente operativa:

"shared_inventory"

Inventario compartido entre sucursales.

Caja

Estado: FUNCIONAL

Clientes

Estado: FUNCIONAL

Supabase

Estado: FUNCIONAL

Seguridad / RLS

Estado: PROTEGIDO

Nota: estos estados representan el estado conocido del repositorio y deben validarse después de cambios importantes.

---

POS

Estado: EN REVISIÓN

Funciones existentes:

- productos
- carrito
- cantidades
- variantes
- SKU
- código de barras
- descuentos
- notas
- métodos de pago
- crédito
- pago mixto
- cancelación
- ticket
- compartir
- inventario compartido

---

PROBLEMAS CONOCIDOS

1. Pago móvil

Debe garantizarse que el método elegido por el usuario llegue correctamente a la mutation de venta.

No depender de un "setState()" inmediatamente anterior.

Métodos afectados potencialmente:

- tarjeta
- transferencia
- crédito
- mixto

---

2. Guardar para más

El botón de guardar para después necesita determinarse si realmente debe estacionar/persistir el carrito o únicamente regresar al catálogo.

No convertirlo en una operación de base de datos sin analizar primero la arquitectura existente.

---

3. Stock móvil

Verificar que las tarjetas de productos móviles muestren correctamente el stock disponible cuando corresponda.

---

4. Categorías móviles

Verificar que las categorías sean accesibles correctamente en teléfono.

---

5. Caja móvil

Verificar overflow, scroll y visibilidad de contenido en dispositivos pequeños.

---

PARIDAD DE PANTALLAS

Inicio / Resumen

Estado: EN DESARROLLO

CEO

Estado: EN DESARROLLO

POS / Caja

Estado: EN DESARROLLO

Productos

Estado: EN DESARROLLO

Inventario

Estado: EN DESARROLLO

Compras

Estado: EN DESARROLLO

Clientes

Estado: EN DESARROLLO

Ventas

Estado: EN DESARROLLO

Gastos

Estado: EN DESARROLLO

Caja

Estado: EN DESARROLLO

Devoluciones

Estado: EN DESARROLLO

Pedidos

Estado: EN DESARROLLO

Reportes

Estado: EN DESARROLLO

Ajustes / Usuarios

Estado: EN DESARROLLO

Reposición

Estado: EN DESARROLLO

---

DEFINICIÓN DE PANTALLA TERMINADA

Una pantalla NO se considera terminada solamente porque se vea bien.

Debe comprobarse:

- diseño
- responsive
- navegación
- funciones
- datos
- permisos
- estados vacíos
- errores
- loading
- integración con Supabase cuando corresponda
- interacción móvil
- interacción escritorio

---

OBJETIVO DE LA ETAPA ACTUAL

1. Proteger el motor.
2. Corregir problemas funcionales conocidos.
3. Continuar mejoras visuales.
4. Mejorar responsive.
5. Alcanzar paridad funcional con las necesidades de Lula Shop.
6. Mantener arquitectura estable.

---

REGLA PARA ACTUALIZAR ESTE ARCHIVO

Después de una modificación importante, actualizar:

- estado
- problemas conocidos
- funciones terminadas
- pendientes

No declarar una función terminada sin haberla probado.