# Lula Shop OS — roadmap

- [ ] Corregir lecturas de inventario/productos desde shared_inventory y validar variantes y sucursal, sin alterar datos ni módulos ajenos.
- [ ] Documentar bloqueo de escrituras: RPCs vigentes usan inventory y shared_inventory carece de branch_id.

- [x] Base de datos en la nube + esquema completo + RLS
- [x] Autenticación email/contraseña + login/registro
- [x] Armazón de la app (menú lateral, selector de sucursal)
- [x] /ventas, /productos, /inventario, /clientes, /compras
- [x] /caja, /reportes, /ajustes
- [x] Corregir errores de compilación (build)
- [ ] Unificar importación Excel/CSV y validar acciones, campos y errores sin escribir en producción.
- [ ] Corregir URL, vista previa y fallback de imágenes; documentar Storage ausente.
- [ ] Validar cambios locales y documentar requisitos pendientes del importador.
