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

---

Fecha
2026-09-22

Sesión / IA
Claude (Claude.ai, sesión de auditoría + POS)

Fase
F3 — POS

Estado
EN PROCESO

Trabajo realizado
- Auditoría completa de PROJECT_CONTEXT.md, IMPLEMENTATION_PROGRESS.md, CHANGELOG_AI.md, AI_CONTINUATION.md (ya existían de una sesión previa del mismo día).
- Lectura completa de POSPanel.tsx y TicketModal.tsx.
- Se detectó que "ticketDiscount" y "saleNotes" tenían estado y lógica de cálculo pero NINGÚN input en la UI (imposible de usar). Se agregaron los campos de Descuento y Nota en el panel de totales.
- Se detectó que los productos con has_variants=true se agregaban al carrito como producto simple, sin selector de variante, y el stock mostrado en la tarjeta usaba únicamente inventory.product_id (variant_id NULL), mostrando 0/incorrecto para productos con variantes.
- Se agregó selector de variantes (dialog) que consulta product_variants (tabla real, no inventada) y agrega la línea al carrito con variant_id correcto, precio (price_override si existe) y stock por variante.
- Se agregó stock agregado por producto (suma de variantes) para la tarjeta de producto en la grilla.
- Se agregó botón "Compartir" en TicketModal (Web Share API con fallback a WhatsApp wa.me), sin tocar impresión existente.

Archivos creados
NINGUNO

Archivos modificados
- src/components/pos/POSPanel.tsx
- src/components/pos/TicketModal.tsx
- IMPLEMENTATION_PROGRESS.md (este archivo)
- CHANGELOG_AI.md

Archivos eliminados
NINGUNO

Base de datos
Sin cambios de base de datos. Se usó product_variants e inventory.variant_id, que ya existían en las migrations locales (20260918070622_...sql). No se inventó ninguna tabla/columna/RPC.

Validación
- Revisión manual línea por línea de los diffs.
- Balance de llaves/paréntesis/corchetes verificado con script.
- NO se ejecutó "tsc", build ni lint: el entorno de esta sesión no tiene acceso a red para "npm install"/"bun install", por lo que no hay node_modules disponible. Pendiente ejecutar validación real (tsc + build) en un entorno con dependencias instaladas antes de mergear.

Problemas encontrados
- La escritura del stock por variante genera dos queries de inventory por sucursal (pos-products y pos-variant-inventory). Es funcionalmente correcto pero podría optimizarse fusionando en una sola consulta en una futura pasada.
- Aún no hay escaneo por cámara (BarcodeDetector/getUserMedia) — no se implementó en esta sesión, ver Pendientes.
- No existe función de cancelación/anulación de venta en el mismo turno (distinta de "devoluciones", que vive en el módulo de Devoluciones aparte). No se implementó porque depende de decidir si reutiliza refund_sale (RPC huérfana, cuerpo desconocido) o requiere una RPC nueva — bloqueo real, ver Bloqueos.

Pendientes
- Validar con "npm install && tsc --noEmit && npm run build" en un entorno con red antes de desplegar.
- Ejecutar la migration pendiente "20260922180000_fix_permissive_rls_expenses_credit_payments.sql" en Supabase (detectada en la sesión anterior, sigue pendiente).
- Escaneo de código de barras por cámara en POS (BarcodeDetector API o librería), listado en PROJECT_CONTEXT.md sección 6.
- Cancelación/anulación de venta en el mismo turno desde POS.
- Revisar si el input de variantes necesita también permitir búsqueda de variantes por SKU en el buscador principal (actualmente el buscador solo matchea SKU/barcode de products, no de product_variants).

Bloqueos
- No se conoce el cuerpo de la RPC "refund_sale" ni si soporta "cancelación en el mismo turno" vs "devolución posterior". Antes de construir cancelación de venta, se necesita: (a) el cuerpo real de refund_sale, o (b) confirmación explícita de si se debe crear una RPC nueva "cancel_sale" y su contrato exacto (parámetros, efecto en inventario y caja).

SIGUIENTE TAREA EXACTA
Con acceso a un entorno con "npm"/"bun" y red: instalar dependencias, correr "tsc --noEmit" y "build" sobre los dos archivos modificados, corregir cualquier error de tipos, y continuar F3 con el buscador de variantes por SKU y el escaneo por cámara. Después decidir el bloqueo de cancelación de venta con el usuario.

---

Fecha
2026-09-22

Sesión / IA
Claude (Claude.ai, misma sesión, continuación)

Fase
F3 — POS

Estado
EN PROCESO

Trabajo realizado
- Búsqueda de variantes por SKU/nombre en el buscador principal del POS: antes el buscador solo indexaba products.name/sku/barcode; ahora un producto con variantes también aparece en la grilla si el texto matchea el SKU o nombre de alguna de sus variantes.
- Escaneo/Enter: si el texto ingresado coincide exactamente con el SKU de una variante, se agrega esa variante directo al carrito (mismo comportamiento que ya existía para SKU/barcode de producto simple), sin pasar por el selector.
- Se reemplazó la consulta de variantes "por producto" (lazy, una petición por cada vez que se abría el picker) por una sola consulta "pos-all-variants" que trae todas las variantes una vez; el picker ahora filtra en memoria con useMemo. Reduce round-trips y habilita la búsqueda global.

Archivos creados
NINGUNO

Archivos modificados
- src/components/pos/POSPanel.tsx

Archivos eliminados
NINGUNO

Base de datos
Sin cambios de base de datos. Sigue usando product_variants e inventory.variant_id existentes.

Validación
- Revisión manual del diff.
- Balance de llaves/paréntesis/corchetes verificado con script.
- Sigue sin poder ejecutarse tsc/build real en esta sesión (sin red para instalar dependencias). Acumulado con el checkpoint anterior: validar ambos cambios juntos antes de desplegar.

Problemas encontrados
- Ninguno nuevo. Se mantiene el mismo bloqueo de cancelación de venta del checkpoint anterior (RPC refund_sale sin cuerpo conocido).

Pendientes
- Los mismos del checkpoint anterior (tsc/build real, migration RLS pendiente de ejecutar, escaneo por cámara, cancelación de venta).

Bloqueos
- Mismo bloqueo: cuerpo real de "refund_sale" o definición de una RPC nueva "cancel_sale" para cancelación en el mismo turno.

SIGUIENTE TAREA EXACTA
Con red disponible: validar tsc/build de POSPanel.tsx y TicketModal.tsx juntos. Si pasa, continuar con escaneo de código de barras por cámara (BarcodeDetector API con fallback, ya que no todos los navegadores la soportan). Antes de tocar cancelación de venta, se necesita respuesta del usuario sobre el bloqueo documentado arriba.

---

Fecha
2026-09-22

Sesión / IA
Claude (Claude.ai, continuación — 3ra vuelta)

Fase
F3 — POS

Estado
EN PROCESO

Trabajo realizado
- Escaneo de código de barras por cámara en el POS, usando la API nativa del navegador "BarcodeDetector" (Chrome/Edge/Android) vía getUserMedia — no se agregó ninguna librería externa nueva al proyecto.
- Botón de cámara junto al buscador que abre un diálogo con el video en vivo; al detectar un código, se resuelve igual que un SKU/barcode/SKU-de-variante escrito manualmente (se reutilizó la lógica extraída a "resolveAndAddByCode").
- Si el navegador no soporta BarcodeDetector, o se niega el permiso de cámara, se muestra un aviso claro y se sugiere usar lector USB o escritura manual — no rompe el flujo existente.
- Se refactorizó "handleSearchKey" para reusar "resolveAndAddByCode" (antes tenía la lógica duplicada); comportamiento idéntico al de antes para Enter manual.

Archivos creados
NINGUNO

Archivos modificados
- src/components/pos/POSPanel.tsx

Archivos eliminados
NINGUNO

Base de datos
Sin cambios de base de datos.

Validación
- Revisión manual del diff.
- Balance de llaves/paréntesis/corchetes verificado con script.
- Sigue sin poder ejecutarse tsc/build real en esta sesión (sin red). Nota: BarcodeDetector no está tipado por defecto en lib.dom.d.ts de TypeScript en todas las configuraciones — se usó un cast explícito a través de "unknown" para evitar depender de tipos no garantizados; validar que compile en el entorno real.

Problemas encontrados
- BarcodeDetector no está soportado en Safari/iOS ni en Firefox de escritorio a la fecha de este conocimiento — en esos navegadores se mostrará el aviso de fallback. Si la mayoría de tus cajeros usan iPhone, este feature no les servirá y seguirán necesitando lector USB o tecleo manual; avisar al usuario.
- Mismo bloqueo de cancelación de venta que checkpoints anteriores (RPC refund_sale sin cuerpo conocido) — sigue sin resolverse, el usuario no respondió aún.

Pendientes
- Validar tsc/build real de los 3 archivos tocados en esta fase (POSPanel.tsx, TicketModal.tsx) en un entorno con red.
- Migration RLS pendiente de ejecutar en Supabase (de checkpoints anteriores).
- Decidir bloqueo de cancelación de venta.
- Si la mayoría de cajeros usa iPhone/Safari, evaluar alternativa (librería JS de decodificación por canvas) — implicaría agregar una dependencia nueva al package.json, lo cual requiere autorización explícita del usuario antes de hacerlo.

Bloqueos
- Mismo bloqueo: cuerpo real de "refund_sale" o definición de una RPC nueva "cancel_sale".

SIGUIENTE TAREA EXACTA
Validar tsc/build en un entorno con red. Confirmar con el usuario si la mayoría de cajeros usa Android/Chrome (BarcodeDetector funciona) o iPhone (necesitaría otra solución). Seguir esperando respuesta sobre refund_sale para desbloquear cancelación de venta.