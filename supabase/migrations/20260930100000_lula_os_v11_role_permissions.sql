-- ============================================================
-- LULA OS v1.1 — PERMISOS GRANULARES
-- ============================================================
-- Agrega permisos configurables por rol sin reemplazar:
--   - app_role
--   - user_roles
--   - profiles.branch_id
--   - is_admin()
--   - is_manager()
--   - admin_set_user_access()
--
-- NO modifica inventario ni inventario compartido.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.permission_catalog (
  key text PRIMARY KEY,
  module text NOT NULL,
  action text NOT NULL,
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS permission_catalog_module_idx
ON public.permission_catalog (
  module,
  sort_order,
  key
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role public.app_role NOT NULL,
  permission_key text NOT NULL
    REFERENCES public.permission_catalog(key)
    ON DELETE CASCADE,
  PRIMARY KEY (
    role,
    permission_key
  )
);

CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
ON public.role_permissions (
  permission_key,
  role
);

ALTER TABLE public.permission_catalog
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permission_catalog_read_authenticated
ON public.permission_catalog;

CREATE POLICY permission_catalog_read_authenticated
ON public.permission_catalog
FOR SELECT
TO authenticated
USING (
  is_active = true
);

DROP POLICY IF EXISTS role_permissions_read_authenticated
ON public.role_permissions;

CREATE POLICY role_permissions_read_authenticated
ON public.role_permissions
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = role
  )
);

REVOKE INSERT, UPDATE, DELETE
ON public.permission_catalog
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.role_permissions
FROM authenticated;


-- ============================================================
-- CATÁLOGO DE PERMISOS
-- ============================================================

INSERT INTO public.permission_catalog
(
  key,
  module,
  action,
  label,
  description,
  sort_order
)
VALUES

-- VENTAS
(
  'ventas.view',
  'ventas',
  'view',
  'Ver ventas',
  'Acceder al módulo de ventas.',
  10
),
(
  'ventas.create',
  'ventas',
  'create',
  'Crear ventas',
  'Registrar ventas.',
  11
),
(
  'ventas.cancel',
  'ventas',
  'cancel',
  'Cancelar ventas',
  'Cancelar una venta.',
  12
),
(
  'ventas.discount',
  'ventas',
  'discount',
  'Aplicar descuentos',
  'Aplicar descuentos en ventas.',
  13
),

-- PRODUCTOS
(
  'productos.view',
  'productos',
  'view',
  'Ver productos',
  'Acceder al catálogo de productos.',
  20
),
(
  'productos.create',
  'productos',
  'create',
  'Crear productos',
  'Crear productos.',
  21
),
(
  'productos.edit',
  'productos',
  'edit',
  'Editar productos',
  'Modificar productos y variantes.',
  22
),
(
  'productos.delete',
  'productos',
  'delete',
  'Eliminar productos',
  'Eliminar productos.',
  23
),
(
  'productos.price',
  'productos',
  'price',
  'Cambiar precios',
  'Modificar precios de venta y costo.',
  24
),

-- INVENTARIO
(
  'inventario.view',
  'inventario',
  'view',
  'Ver inventario',
  'Consultar existencias.',
  30
),
(
  'inventario.adjust',
  'inventario',
  'adjust',
  'Ajustar inventario',
  'Realizar ajustes de inventario.',
  31
),
(
  'inventario.physical_count',
  'inventario',
  'physical_count',
  'Inventario físico',
  'Realizar conteos físicos.',
  32
),

-- CLIENTES
(
  'clientes.view',
  'clientes',
  'view',
  'Ver clientes',
  'Consultar clientes.',
  40
),
(
  'clientes.create',
  'clientes',
  'create',
  'Crear clientes',
  'Registrar clientes.',
  41
),
(
  'clientes.edit',
  'clientes',
  'edit',
  'Editar clientes',
  'Modificar clientes.',
  42
),
(
  'clientes.credit',
  'clientes',
  'credit',
  'Gestionar crédito',
  'Gestionar crédito de clientes.',
  43
),
(
  'clientes.credit_payment',
  'clientes',
  'credit_payment',
  'Registrar abonos',
  'Registrar pagos de crédito.',
  44
),

-- COMPRAS
(
  'compras.view',
  'compras',
  'view',
  'Ver compras',
  'Consultar compras.',
  50
),
(
  'compras.create',
  'compras',
  'create',
  'Crear compras',
  'Registrar compras.',
  51
),
(
  'compras.receive',
  'compras',
  'receive',
  'Recibir compras',
  'Recibir mercancía de compras.',
  52
),

-- CAJA
(
  'caja.view',
  'caja',
  'view',
  'Ver caja',
  'Consultar caja.',
  60
),
(
  'caja.open',
  'caja',
  'open',
  'Abrir caja',
  'Abrir sesión de caja.',
  61
),
(
  'caja.close',
  'caja',
  'close',
  'Cerrar caja',
  'Cerrar sesión de caja.',
  62
),
(
  'caja.movement',
  'caja',
  'movement',
  'Movimientos de caja',
  'Registrar movimientos de caja.',
  63
),

-- GASTOS
(
  'gastos.view',
  'gastos',
  'view',
  'Ver gastos',
  'Consultar gastos.',
  70
),
(
  'gastos.create',
  'gastos',
  'create',
  'Crear gastos',
  'Registrar gastos.',
  71
),
(
  'gastos.edit',
  'gastos',
  'edit',
  'Editar gastos',
  'Modificar gastos.',
  72
),
(
  'gastos.delete',
  'gastos',
  'delete',
  'Eliminar gastos',
  'Eliminar gastos.',
  73
),

-- DEVOLUCIONES
(
  'devoluciones.view',
  'devoluciones',
  'view',
  'Ver devoluciones',
  'Consultar devoluciones.',
  80
),
(
  'devoluciones.create',
  'devoluciones',
  'create',
  'Crear devoluciones',
  'Procesar devoluciones.',
  81
),

-- PEDIDOS
(
  'pedidos.view',
  'pedidos',
  'view',
  'Ver pedidos',
  'Consultar pedidos.',
  90
),
(
  'pedidos.create',
  'pedidos',
  'create',
  'Crear pedidos',
  'Crear pedidos.',
  91
),
(
  'pedidos.edit',
  'pedidos',
  'edit',
  'Editar pedidos',
  'Modificar pedidos.',
  92
),

-- REPOSICIÓN
(
  'reposicion.view',
  'reposicion',
  'view',
  'Ver reposición',
  'Consultar reposiciones.',
  100
),
(
  'reposicion.create',
  'reposicion',
  'create',
  'Crear reposición',
  'Crear solicitudes de reposición.',
  101
),
(
  'reposicion.receive',
  'reposicion',
  'receive',
  'Recibir reposición',
  'Marcar reposiciones como recibidas.',
  102
),

-- REPORTES
(
  'reportes.view',
  'reportes',
  'view',
  'Ver reportes',
  'Consultar reportes.',
  110
),

-- CEO
(
  'ceo.view',
  'ceo',
  'view',
  'Ver CEO',
  'Consultar indicadores CEO.',
  120
),

-- AJUSTES
(
  'ajustes.view',
  'ajustes',
  'view',
  'Ver ajustes',
  'Acceder a ajustes.',
  130
),
(
  'ajustes.manage',
  'ajustes',
  'manage',
  'Administrar ajustes',
  'Modificar configuración.',
  131
),

-- USUARIOS
(
  'usuarios.view',
  'usuarios',
  'view',
  'Ver personal',
  'Consultar usuarios y roles.',
  140
),
(
  'usuarios.manage',
  'usuarios',
  'manage',
  'Administrar personal',
  'Asignar roles, sucursales y activar o desactivar usuarios.',
  141
)

ON CONFLICT (key)
DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true;


-- ============================================================
-- OWNER
-- Mantiene acceso completo.
-- ============================================================

INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'owner'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.is_active
ON CONFLICT DO NOTHING;


-- ============================================================
-- ADMIN
-- Mantiene el alcance administrativo actual.
-- ============================================================

INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'admin'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.is_active
ON CONFLICT DO NOTHING;


-- ============================================================
-- MANAGER
-- Mantiene los módulos actuales de manager.
-- ============================================================

INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'manager'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.module IN (
  'ventas',
  'productos',
  'inventario',
  'clientes',
  'compras',
  'caja',
  'gastos',
  'devoluciones',
  'pedidos',
  'reposicion',
  'reportes',
  'ceo'
)
AND pc.is_active
ON CONFLICT DO NOTHING;


-- ============================================================
-- CASHIER
-- ============================================================

INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'cashier'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.module IN (
  'ventas',
  'clientes',
  'caja',
  'devoluciones',
  'reposicion'
)
AND pc.is_active
AND (
  pc.action = 'view'
  OR pc.key IN (
    'ventas.create',
    'clientes.create',
    'caja.open',
    'caja.close',
    'caja.movement',
    'devoluciones.create',
    'reposicion.create'
  )
)
ON CONFLICT DO NOTHING;


-- ============================================================
-- STAFF
-- ============================================================

INSERT INTO public.role_permissions (
  role,
  permission_key
)
SELECT
  'staff'::public.app_role,
  pc.key
FROM public.permission_catalog pc
WHERE pc.module IN (
  'ventas',
  'clientes',
  'reposicion'
)
AND pc.is_active
AND (
  pc.action = 'view'
  OR pc.key IN (
    'ventas.create',
    'clientes.create',
    'reposicion.create'
  )
)
ON CONFLICT DO NOTHING;


-- ============================================================
-- COMPROBACIÓN DE PERMISO
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_permission(
  _permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur
        ON ur.user_id = p.id
      JOIN public.role_permissions rp
        ON rp.role = ur.role
      JOIN public.permission_catalog pc
        ON pc.key = rp.permission_key
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND pc.is_active = true
        AND rp.permission_key = _permission_key
    );
$$;

REVOKE ALL
ON FUNCTION public.has_permission(text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.has_permission(text)
TO authenticated, service_role;


-- ============================================================
-- PERMISOS DEL USUARIO ACTUAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    ARRAY_AGG(
      DISTINCT rp.permission_key
      ORDER BY rp.permission_key
    ),
    ARRAY[]::text[]
  )
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.id
  JOIN public.role_permissions rp
    ON rp.role = ur.role
  JOIN public.permission_catalog pc
    ON pc.key = rp.permission_key
  WHERE p.id = auth.uid()
    AND p.is_active = true
    AND pc.is_active = true;
$$;

REVOKE ALL
ON FUNCTION public.get_my_permissions()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_my_permissions()
TO authenticated, service_role;


-- ============================================================
-- ADMINISTRAR PERMISOS DE ROLES
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_role_permission(
  _role public.app_role,
  _permission_key text,
  _enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.permission_catalog pc
    WHERE pc.key = _permission_key
      AND pc.is_active = true
  ) THEN
    RAISE EXCEPTION
      'permission not found or inactive';
  END IF;

  IF _role = 'owner'
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role = 'owner'
     )
  THEN
    RAISE EXCEPTION
      'only owner can modify owner permissions';
  END IF;

  IF _enabled THEN

    INSERT INTO public.role_permissions (
      role,
      permission_key
    )
    VALUES (
      _role,
      _permission_key
    )
    ON CONFLICT (
      role,
      permission_key
    )
    DO NOTHING;

  ELSE

    DELETE FROM public.role_permissions
    WHERE role = _role
      AND permission_key = _permission_key;

  END IF;

END;
$$;

REVOKE ALL
ON FUNCTION public.admin_set_role_permission(
  public.app_role,
  text,
  boolean
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_role_permission(
  public.app_role,
  text,
  boolean
)
TO authenticated, service_role;

COMMIT;