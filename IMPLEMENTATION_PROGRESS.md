PROTOCOLO PERMANENTE DE ACTUALIZACIÓN

Este archivo es el checkpoint oficial del desarrollo de Lula Shop OS.

Debe actualizarse al terminar cada bloque importante de trabajo.

Nunca borrar los checkpoints anteriores.

---

FORMATO OBLIGATORIO DE CADA NUEVO CHECKPOINT

Fecha

AAAA-MM-DD

Sesión / IA

Identificar la sesión o IA que realizó el trabajo cuando sea posible.

Fase

Ejemplo:

F3 — POS

Estado

- EN PROCESO
- TERMINADA
- BLOQUEADA

Trabajo realizado

Describir exactamente qué se hizo.

Archivos creados

Lista de archivos nuevos.

Archivos modificados

Lista exacta de archivos.

Archivos eliminados

Si no hubo:

"NINGUNO"

Base de datos

Indicar:

- migrations creadas;
- migrations ejecutadas o pendientes;
- cambios RLS;
- RPCs;
- tablas;
- columnas.

Si no hubo cambios:

"Sin cambios de base de datos."

Validación

Indicar exactamente qué se ejecutó:

- TypeScript;
- build;
- lint;
- tests;
- revisión manual;
- pruebas de UI.

Nunca indicar que algo pasó si no se ejecutó.

Problemas encontrados

Lista concreta.

Pendientes

Lista concreta.

Bloqueos

Información que debe obtenerse antes de continuar.

SIGUIENTE TAREA EXACTA

Debe existir siempre una siguiente tarea concreta.

---

REGLA DE CONTINUIDAD

La siguiente IA debe poder abrir solamente:

- "PROJECT_CONTEXT.md"
- "IMPLEMENTATION_PROGRESS.md"
- "CHANGELOG_AI.md"
- "AI_CONTINUATION.md"

y posteriormente inspeccionar el código para saber:

- qué proyecto está construyendo;
- qué reglas debe respetar;
- qué ya se hizo;
- qué falta;
- dónde continuar.

---

REGLA IMPORTANTE

No marcar una fase como TERMINADA si solamente se completó una parte.

Si una fase está parcialmente completada:

"EN PROCESO"

Si existe un bloqueo real:

"BLOQUEADA"

Si todo lo planeado para esa fase fue validado:

"TERMINADA"

---

REGLA DE HISTORIAL

Nunca eliminar checkpoints anteriores.

Agregar nuevos checkpoints al final.

Esto permite saber cómo evolucionó el sistema y qué IA hizo cada cambio.