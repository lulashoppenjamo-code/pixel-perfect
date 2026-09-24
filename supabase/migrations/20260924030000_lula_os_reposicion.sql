-- ============================================================
-- LULA OS — MÓDULO DE REPOSICIÓN
-- ============================================================
-- IMPORTANTE:
-- Este módulo NO modifica shared_inventory.
-- Solo administra solicitudes/listas de productos por comprar.
-- Recibir una solicitud cambia su estado, pero NO aumenta stock.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.replenishment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  product_id uuid NOT NULL
    REFERENCES public.products(id)
    ON DELETE CASCADE,

  variant_id uuid
    REFERENCES public.product_variants(id)
    ON DELETE SET NULL,

  branch_id uuid
    REFERENCES public.branches(id)
    ON DELETE SET NULL,

  requested_by uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  quantity numeric(12,2) NOT NULL DEFAULT 1,

  note text,

  status text NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'purchased',
        'received',
        'cancelled'
      )
    ),

  created_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now(),

  purchased_at timestamptz,

  received_at timestamptz
);

CREATE INDEX IF NOT EXISTS
replenishment_requests_status_idx
ON public.replenishment_requests(status);

CREATE INDEX IF NOT EXISTS
replenishment_requests_product_idx
ON public.replenishment_requests(product_id);

CREATE INDEX IF NOT EXISTS
replenishment_requests_variant_idx
ON public.replenishment_requests(variant_id);

CREATE INDEX IF NOT EXISTS
replenishment_requests_created_idx
ON public.replenishment_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS
replenishment_requests_branch_idx
ON public.replenishment_requests(branch_id);

DROP TRIGGER IF EXISTS
replenishment_requests_updated_at
ON public.replenishment_requests;

CREATE TRIGGER
replenishment_requests_updated_at
BEFORE UPDATE
ON public.replenishment_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.replenishment_requests
ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE
ON public.replenishment_requests
TO authenticated;

DROP POLICY IF EXISTS
replenishment_requests_read
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_read
ON public.replenishment_requests
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS
replenishment_requests_create
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_create
ON public.replenishment_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
);

DROP POLICY IF EXISTS
replenishment_requests_update
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_update
ON public.replenishment_requests
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
  OR (
    requested_by = auth.uid()
    AND status = 'pending'
  )
)
WITH CHECK (
  public.is_manager()
  OR (
    requested_by = auth.uid()
    AND status = 'pending'
  )
);

COMMENT ON TABLE public.replenishment_requests IS
'LULA OS: lista de reposición independiente del inventario real. No modifica shared_inventory.';

COMMENT ON COLUMN public.replenishment_requests.status IS
'pending=pending, purchased=pedido comprado, received=recibido, cancelled=cancelado. Cambiar a received NO modifica inventario.';

COMMIT;