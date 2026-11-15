# Lula Shop OS — roadmap

- [x] Lecturas de inventario/productos desde shared_inventory (inventoryData) y validación de variantes.
- [x] Escrituras de inventario autorizadas (2026-11-15): RPCs ya usan shared_inventory; bloqueo frontend eliminado. branch_id solo en movimientos.

- [x] Base de datos en la nube + esquema completo + RLS
- [x] Autenticación email/contraseña + login/registro
- [x] Armazón de la app (menú lateral, selector de sucursal)
- [x] /ventas, /productos, /inventario, /clientes, /compras
- [x] /caja, /reportes, /ajustes
- [x] Corregir errores de compilación (build)
- [ ] Unificar importación Excel/CSV y validar acciones, campos y errores sin escribir en producción.
- [ ] Corregir URL, vista previa y fallback de imágenes; documentar Storage ausente.
- [ ] Validar cambios locales y documentar requisitos pendientes del importador.
