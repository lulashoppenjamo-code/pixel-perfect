AI CODE UPDATE PROTOCOL

Lula Shop OS — Protocolo obligatorio para recibir, integrar y continuar código

Este archivo establece cómo debe trabajar cualquier IA que modifique Lula Shop OS.

---

1. REGLA PRINCIPAL

NINGÚN código nuevo debe pegarse o incorporarse directamente sin revisar primero el código existente.

El proyecto debe evolucionar de forma acumulativa:

CÓDIGO ACTUAL → ANALIZAR → INTEGRAR → VALIDAR → GUARDAR → DOCUMENTAR → CONTINUAR

Nunca:

CÓDIGO NUEVO → SOBRESCRIBIR → ROMPER FUNCIONES EXISTENTES

---

2. GITHUB ES LA FUENTE DE VERDAD

El estado real del proyecto es siempre el contenido actual del repositorio GitHub.

La IA NO debe confiar únicamente en:

- su memoria
- conversaciones anteriores
- instrucciones antiguas
- archivos que recibió anteriormente
- supuestos sobre la arquitectura

Antes de modificar debe revisar el repositorio actual.

---

3. ANTES DE PEGAR CUALQUIER CÓDIGO

La IA debe:

Paso 1

Leer:

- "PROJECT_CONTEXT.md"
- "IMPLEMENTATION_PROGRESS.md"
- "CHANGELOG_AI.md"
- "AI_CONTINUATION.md"
- "AI_CODE_UPDATE_PROTOCOL.md"

Paso 2

Identificar:

- fase actual
- última tarea terminada
- archivos modificados recientemente
- funciones existentes
- componentes relacionados
- tablas utilizadas
- RPC existentes
- restricciones conocidas
- problemas pendientes

Paso 3

Leer el archivo real que se va a modificar.

No asumir que el archivo sigue igual que en una conversación anterior.

---

4. CUANDO EL USUARIO ENTREGUE CÓDIGO NUEVO

Si el usuario dice:

"Me dieron este código"

o

"Quiero pegar este código"

la IA debe tratarlo como una PROPUESTA DE CAMBIO, no como una orden de reemplazar el archivo completo.

Debe determinar:

A. ¿Es un archivo nuevo?

Si no existe:

- revisar dónde debe ir
- revisar imports
- revisar dependencias
- revisar rutas
- crear solamente si realmente es necesario

B. ¿Es una modificación de un archivo existente?

Comparar conceptualmente:

CÓDIGO ACTUAL + CÓDIGO NUEVO

y conservar todo lo que ya funciona.

C. ¿El código nuevo reemplaza funciones existentes?

NO hacerlo automáticamente.

Primero integrar las nuevas funciones dentro de la implementación existente.

---

5. REGLA DE NO REGRESIÓN

Una mejora nunca debe eliminar accidentalmente:

- POS
- inventario
- productos
- compras
- clientes
- crédito
- caja
- gastos
- devoluciones
- pedidos
- reportes
- CEO
- autenticación
- roles
- permisos
- navegación
- responsive
- impresión
- tickets
- funciones existentes

Si una modificación afecta una función existente, debe conservarse.

---

6. INVENTARIO COMPARTIDO

REGLA CRÍTICA:

Lula Shop tiene DOS SUCURSALES pero el inventario es COMPARTIDO.

Nunca convertirlo accidentalmente en:

Sucursal A = inventario independiente

Sucursal B = inventario independiente

El sistema actual debe conservar su modelo de inventario compartido.

---

7. BASE DE DATOS

Nunca inventar:

- tablas
- columnas
- enums
- RPC
- funciones SQL
- políticas RLS
- índices
- relaciones

Si una función necesita algo de base de datos que no existe, primero revisar el esquema real.

Si no puede verificarse:

1. no inventarlo
2. documentar el bloqueo
3. continuar con las partes seguras

---

8. RPC

Nunca crear una llamada a una RPC solamente porque "parece lógico".

Antes de usar una RPC:

- buscarla en el proyecto
- revisar su firma
- revisar cómo se utiliza actualmente
- verificar tipos
- verificar parámetros

Si existe en Supabase pero no está definida localmente, NO reemplazarla por una RPC inventada.

---

9. ARCHIVOS COMPLETOS

Si la IA entrega un archivo completo para reemplazar otro:

ANTES DE REEMPLAZARLO debe comprobar:

- imports actuales
- funciones actuales
- hooks actuales
- queries actuales
- mutations actuales
- estados actuales
- props actuales
- componentes actuales
- permisos
- rutas
- tipos
- RPC
- comportamiento existente

Después debe integrar las mejoras.

---

10. CAMBIOS PEQUEÑOS

Siempre que sea posible:

MODIFICAR → VALIDAR → GUARDAR

en lugar de cambiar 20 archivos sin validar.

Las mejoras grandes pueden dividirse en bloques internos, pero la IA debe continuar automáticamente cuando sea seguro.

---

11. VALIDACIÓN OBLIGATORIA

Después de modificar código, comprobar como mínimo:

- imports
- exports
- nombres de archivos
- rutas
- tipos TypeScript
- hooks
- queries
- mutations
- llamadas a Supabase
- componentes utilizados
- estados
- props
- permisos
- navegación
- responsive

Si existen herramientas disponibles, ejecutar:

- TypeScript check
- lint
- build
- tests

Si no se pueden ejecutar por falta de dependencias o entorno, documentarlo claramente.

---

12. SI APARECE UN ERROR

NO solucionar el error destruyendo otra funcionalidad.

Proceso:

ERROR → IDENTIFICAR CAUSA → CORREGIR CAUSA → VALIDAR → DOCUMENTAR

No:

ERROR → BORRAR FUNCIONALIDAD

---

13. SI EL CÓDIGO NUEVO ES INCOMPATIBLE

No sobrescribir.

Explicar brevemente:

- qué conflicto existe
- qué parte del código actual debe conservarse
- qué parte del código nuevo puede integrarse
- cuál es la solución compatible

Después realizar la integración segura si es posible.

---

14. CHECKPOINT OBLIGATORIO

Después de cada cambio significativo actualizar:

"IMPLEMENTATION_PROGRESS.md"

Debe incluir:

- fecha
- fase
- tarea
- estado
- archivos modificados
- cambios realizados
- cambios de base de datos
- validaciones
- errores
- problemas pendientes
- siguiente tarea exacta

---

15. CHANGELOG

También actualizar:

"CHANGELOG_AI.md"

Registrar:

- qué cambió
- por qué
- archivos afectados
- si hubo migración
- si hubo corrección
- si hubo riesgo
- siguiente paso

---

16. NO REPETIR TRABAJO

Antes de implementar una función, buscar si ya existe.

No crear una segunda versión de:

- POS
- scanner
- ticket
- carrito
- navegación
- clientes
- inventario
- compras
- caja
- etc.

Si ya existe:

EXTENDERLA.

---

17. CAMBIO DE IA

Si el usuario cambia de:

Claude → Grok

Grok → Claude

Claude → otra IA

la nueva IA debe continuar desde GitHub.

Debe leer los archivos de continuidad y determinar el punto exacto.

No debe comenzar nuevamente.

---

18. INSTRUCCIÓN PARA LA IA

Cuando el usuario entregue código nuevo, ejecutar mentalmente:

«"No debo reemplazar ciegamente el código existente. Primero debo analizar cómo encaja con la arquitectura actual de Lula Shop OS, conservar las funciones existentes, integrar solamente la mejora necesaria, validar y actualizar el checkpoint."»

---

19. OBJETIVO FINAL

Lula Shop OS debe crecer de manera acumulativa hasta convertirse en un sistema completo de operación empresarial con:

- POS
- inventario robusto
- compras
- productos
- clientes
- crédito
- caja
- gastos
- devoluciones
- pedidos
- tienda en línea
- reportes
- CEO
- futura IA empresarial

La experiencia debe ser muy cercana a Zobaze en funcionalidad y flujo, pero la implementación, código, identidad y arquitectura deben ser propios.

---

20. REGLA FINAL

Cada IA debe dejar el proyecto:

IGUAL O MEJOR QUE COMO LO RECIBIÓ.

Nunca peor.

Si una mejora no puede realizarse con seguridad:

NO ROMPER EL SISTEMA.

Documentar el bloqueo y continuar con las tareas seguras.