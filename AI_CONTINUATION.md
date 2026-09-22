LULA SHOP OS — AI CONTINUATION PROTOCOL

PROPÓSITO

Este proyecto será desarrollado mediante diferentes sesiones y posiblemente diferentes cuentas/modelos de IA.

El repositorio de GitHub debe permitir que cualquier IA autorizada continúe el trabajo sin depender de una conversación anterior.

---

PASO 1 — LEER DOCUMENTACIÓN

Antes de tocar código:

1. Leer "PROJECT_CONTEXT.md".
2. Leer "IMPLEMENTATION_PROGRESS.md".
3. Leer "CHANGELOG_AI.md".
4. Leer este archivo.
5. Inspeccionar el código real relacionado con la tarea.

NO comenzar a programar antes de hacerlo.

---

PASO 2 — IDENTIFICAR EL CHECKPOINT

Buscar en:

"IMPLEMENTATION_PROGRESS.md"

la sección:

"SIGUIENTE TAREA EXACTA"

Esa es la tarea desde la cual se debe continuar.

No repetir fases marcadas como terminadas.

---

PASO 3 — VERIFICAR EL CÓDIGO REAL

La documentación puede quedar desactualizada.

Por eso:

DOCUMENTACIÓN
+
CÓDIGO REAL

deben compararse.

Si existe una contradicción:

1. investigar;
2. determinar el estado real;
3. corregir la documentación;
4. continuar.

No inventar.

---

PASO 4 — METODOLOGÍA

Para cada función:

AUDITAR
→ COMPARAR
→ IMPLEMENTAR
→ VALIDAR
→ DOCUMENTAR

---

PASO 5 — NO REESCRIBIR

NO:

- comenzar de cero;
- cambiar framework;
- reemplazar toda la aplicación;
- borrar módulos;
- reemplazar componentes funcionales;
- crear una segunda arquitectura;
- duplicar inventario;
- duplicar lógica de ventas.

Sí:

- extender;
- corregir;
- mejorar;
- integrar;
- refactorizar solamente cuando sea necesario y seguro.

---

PASO 6 — ZOBAZE

Utilizar Zobaze como referencia funcional.

El objetivo es alcanzar una experiencia muy cercana y una cobertura funcional muy alta.

No copiar código propietario.

Comparar:

- flujos;
- pantallas;
- acciones;
- estados;
- comportamiento;
- responsive;
- POS;
- inventario;
- compras;
- clientes;
- crédito;
- caja;
- tickets;
- devoluciones;
- reportes.

La implementación debe ser propia.

---

PASO 7 — INVENTARIO

REGLA ABSOLUTA:

DOS SUCURSALES.

INVENTARIO COMPARTIDO.

Nunca crear dos sistemas de inventario independientes.

Antes de cambiar stock:

leer la implementación actual.

---

PASO 8 — BASE DE DATOS

Antes de crear/modificar SQL:

1. revisar migrations;
2. revisar schema conocido;
3. revisar RLS;
4. revisar RPCs;
5. revisar tipos generados.

NO inventar:

- tablas;
- columnas;
- enums;
- relaciones;
- RPCs;
- políticas.

---

PASO 9 — RPCS

Si una RPC existe en producción pero no se conoce su cuerpo:

NO inventarla.

Ejemplo de RPCs conocidas:

- "refund_sale"
- "transfer_stock"
- "create_online_order"
- "fulfill_online_order"
- "cancel_online_order"

Obtener definición real antes de modificar.

---

PASO 10 — SEGURIDAD

No confiar únicamente en:

- botones ocultos;
- menús;
- rutas;
- frontend.

Las operaciones sensibles deben estar protegidas mediante:

- RLS;
- RPC;
- autorización backend;
- permisos reales.

Recordar:

Las políticas permisivas de PostgreSQL se combinan mediante OR.

---

PASO 11 — VALIDACIÓN

Después de modificar código:

Revisar:

- imports;
- TypeScript;
- hooks;
- queries;
- mutations;
- RPCs;
- estados;
- navegación;
- responsive;
- errores de compilación.

Ejecutar cuando sea posible:

- "tsc";
- build;
- lint;
- tests.

Nunca afirmar que una prueba pasó si no fue ejecutada.

---

PASO 12 — DOCUMENTACIÓN AUTOMÁTICA

Después de cada bloque importante:

Actualizar:

"IMPLEMENTATION_PROGRESS.md"

Agregar entrada a:

"CHANGELOG_AI.md"

La actualización debe incluir:

- fecha;
- fase;
- cambios;
- archivos;
- DB;
- validación;
- errores;
- pendientes;
- siguiente tarea.

---

PASO 13 — GIT

Si existe acceso al repositorio:

Revisar cambios.

Crear commit.

Hacer push cuando esté autorizado.

NO utilizar:

- force push;
- reset destructivo;
- eliminación masiva;
- operaciones que puedan borrar trabajo anterior.

---

PASO 14 — NO DETENERSE INNECESARIAMENTE

Si una subtarea segura puede resolverse sin intervención del usuario:

resolverla.

No preguntar:

"¿Quieres que continúe?"

entre cada pequeño bloque.

Continuar hasta:

- terminar la fase;
- encontrar un bloqueo real;
- necesitar información que no puede obtenerse del código/documentación.

---

PASO 15 — SI EXISTE UN BLOQUEO REAL

No inventar una solución.

Documentar:

BLOQUEO

Qué falta.

POR QUÉ

Por qué no puede continuar de forma segura.

INFORMACIÓN NECESARIA

Qué debe proporcionar el usuario.

Mientras exista trabajo seguro independiente:

continuar con ese trabajo.

---

PASO 16 — CAMBIO DE CUENTA

Cuando una cuenta termine:

Debe dejar actualizado:

- código;
- "PROJECT_CONTEXT.md";
- "IMPLEMENTATION_PROGRESS.md";
- "CHANGELOG_AI.md";
- "AI_CONTINUATION.md".

La siguiente cuenta debe abrir el mismo repositorio.

Después debe leer los cuatro archivos.

No necesita la conversación anterior.

---

MENSAJE PARA INICIAR UNA NUEVA CUENTA DE CLAUDE

Copiar:

"CONTINÚA LULA SHOP OS DESDE EL REPOSITORIO ACTUAL.

Primero lee completamente:

PROJECT_CONTEXT.md
IMPLEMENTATION_PROGRESS.md
CHANGELOG_AI.md
AI_CONTINUATION.md

Después inspecciona el código real.

Determina exactamente:

1. qué fases están terminadas;
2. cuál es la fase actual;
3. cuál es la siguiente tarea;
4. qué archivos debes revisar.

NO empieces desde cero.

NO repitas fases terminadas.

NO reescribas el proyecto.

NO borres funcionalidades.

NO inventes RPCs.

NO inventes tablas, columnas, enums o RLS.

MANTÉN EL INVENTARIO COMPARTIDO ENTRE LAS DOS SUCURSALES.

El objetivo del proyecto es construir Lula Shop OS con una cobertura funcional y experiencia de uso muy cercana a Zobaze, pero con implementación, código, identidad y arquitectura propios.

Trabaja autónomamente dentro de la fase actual.

Antes de terminar:

- valida lo realizado;
- actualiza IMPLEMENTATION_PROGRESS.md;
- actualiza CHANGELOG_AI.md;
- deja documentado el siguiente checkpoint exacto.

No me pidas confirmación entre subtareas seguras."

---

REGLA FINAL

El proyecto NO depende de una conversación.

El proyecto depende de:

GITHUB
+
CÓDIGO
+
DOCUMENTACIÓN
+
CHECKPOINTS

Por lo tanto:

Claude 1
→ GitHub
→ Claude 2
→ GitHub
→ Claude 3
→ GitHub
→ Claude 4

debe poder continuar sin perder el contexto.