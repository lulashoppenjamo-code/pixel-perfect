
-- Lula Shop OS
-- Corrección aditiva: evitar Duplicate key al autorizar
-- nuevamente una tablet cuyo secreto ya está registrado.
--
-- No elimina registros ni modifica PIN, usuarios, permisos,
-- RLS, ventas, caja o inventario.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_authorize_pos_device(
  _device_name text,
  _device_secret text,
  _branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_secret text := trim(COALESCE(_device_secret, ''));
  v_secret_hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;

  IF length(v_secret) < 32 THEN
    RAISE EXCEPTION 'device secret is invalid';
  END IF;

  IF _branch_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.branches b
       WHERE b.id = _branch_id
         AND b.is_active = true
     )
  THEN
    RAISE EXCEPTION 'branch not found or inactive';
  END IF;

  v_secret_hash :=
    encode(
      digest(v_secret, 'sha256'),
      'hex'
    );

  INSERT INTO public.authorized_pos_devices (
    device_name,
    device_secret_hash,
    branch_id,
    authorized_by,
    is_active,
    updated_at
  )
  VALUES (
    COALESCE(
      NULLIF(trim(_device_name), ''),
      'Tablet Lula Shop'
    ),
    v_secret_hash,
    _branch_id,
    auth.uid(),
    true,
    now()
  )
  ON CONFLICT (device_secret_hash)
  DO UPDATE SET
    device_name = EXCLUDED.device_name,
    branch_id = EXCLUDED.branch_id,
    authorized_by = EXCLUDED.authorized_by,
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.admin_authorize_pos_device(text, text, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_authorize_pos_device(text, text, uuid)
TO authenticated;

COMMIT;
