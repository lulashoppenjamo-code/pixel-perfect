BEGIN;

-- ============================================================
-- LULA SHOP
-- CONFIGURACIÓN DEL ROL COLABORADOR
--
-- staff = Colaborador
--
-- No elimina ningún rol existente.
-- No modifica inventario compartido.
-- No modifica ventas, RPCs ni RLS.
-- ============================================================

-- Consulta de productos e inventario
INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.key IN (
  'productos.view',
  'inventario.view'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


-- Ventas y cobro
INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.key IN (
  'ventas.view',
  'ventas.create'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


-- Clientes
INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.key IN (
  'clientes.view',
  'clientes.create'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


-- Caja: las colaboradoras pueden trabajar la caja
INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.key IN (
  'caja.view',
  'caja.open',
  'caja.close',
  'caja.movement'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


-- Devoluciones
INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.key IN (
  'devoluciones.view',
  'devoluciones.create'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


-- Reposición
INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.key IN (
  'reposicion.view',
  'reposicion.create'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


COMMIT;