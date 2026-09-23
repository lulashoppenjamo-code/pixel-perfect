-- ============================================================
-- LULA OS
-- Inventario compartido - cierre operativo
-- ============================================================

create unique index if not exists
shared_inventory_product_variant_unique
on public.shared_inventory (
  product_id,
  coalesce(
    variant_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);


-- ============================================================
-- LÍMITES DE INVENTARIO COMPARTIDO
-- ============================================================

create or replace function public.set_shared_inventory_limits(
  _product_id uuid,
  _variant_id uuid default null,
  _min_stock numeric default 0,
  _max_stock numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Sin permisos para modificar límites de inventario';
  end if;

  if _min_stock < 0 then
    raise exception 'El mínimo no puede ser negativo';
  end if;

  if _max_stock is not null
     and _max_stock < _min_stock then
    raise exception 'El máximo no puede ser menor al mínimo';
  end if;

  insert into public.shared_inventory (
    product_id,
    variant_id,
    stock,
    reserved_stock,
    min_stock,
    max_stock
  )
  values (
    _product_id,
    _variant_id,
    0,
    0,
    _min_stock,
    _max_stock
  )
  on conflict (
    product_id,
    coalesce(
      variant_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  do update
  set
    min_stock = excluded.min_stock,
    max_stock = excluded.max_stock;

end;
$$;


grant execute on function
public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
to authenticated;


-- ============================================================
-- AJUSTE OPERATIVO
-- El frontend sigue llamando adjust_stock().
-- El stock real se modifica en shared_inventory.
-- ============================================================

create or replace function public.adjust_stock(
  _branch_id uuid,
  _product_id uuid,
  _quantity numeric,
  _variant_id uuid default null,
  _notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Sin permisos para ajustar inventario';
  end if;

  if _quantity = 0 then
    return;
  end if;

  perform public.adjust_shared_stock(
    _product_id,
    _variant_id,
    _quantity,
    coalesce(
      _notes,
      case
        when _quantity > 0
          then 'Ajuste de inventario'
        else 'Salida de inventario'
      end
    )
  );
end;
$$;


grant execute on function
public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
to authenticated;


-- ============================================================
-- CONSULTA DE STOCK DISPONIBLE
-- ============================================================

create or replace function public.available_stock(
  _branch_id uuid,
  _product_id uuid,
  _variant_id uuid default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result numeric;
begin
  select coalesce(
    si.stock - si.reserved_stock,
    0
  )
  into result
  from public.shared_inventory si
  where si.product_id = _product_id
    and (
      si.variant_id = _variant_id
      or (
        si.variant_id is null
        and _variant_id is null
      )
    )
  limit 1;

  return coalesce(result, 0);
end;
$$;


grant execute on function
public.available_stock(
  uuid,
  uuid,
  uuid
)
to authenticated;


-- ============================================================
-- INVENTARIO GENERAL
-- ============================================================

create or replace function public.get_inventory_summary()
returns table (
  total_products bigint,
  total_stock numeric,
  total_reserved numeric,
  total_available numeric,
  inventory_cost numeric,
  inventory_retail numeric,
  low_stock_products bigint,
  out_of_stock_products bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(si.stock), 0),
    coalesce(sum(si.reserved_stock), 0),
    coalesce(
      sum(si.stock - si.reserved_stock),
      0
    ),
    coalesce(
      sum(si.stock * coalesce(p.cost, 0)),
      0
    ),
    coalesce(
      sum(si.stock * coalesce(p.price, 0)),
      0
    ),
    count(*) filter (
      where
        si.stock - si.reserved_stock
        <= si.min_stock
    )::bigint,
    count(*) filter (
      where
        si.stock - si.reserved_stock <= 0
    )::bigint
  from public.shared_inventory si
  join public.products p
    on p.id = si.product_id
  where p.is_active = true;
$$;


grant execute on function
public.get_inventory_summary()
to authenticated;


-- ============================================================
-- ÍNDICES
-- ============================================================

create index if not exists
shared_inventory_product_idx
on public.shared_inventory(product_id);

create index if not exists
shared_inventory_variant_idx
on public.shared_inventory(variant_id);

create index if not exists
shared_inventory_available_idx
on public.shared_inventory(
  product_id,
  variant_id,
  stock,
  reserved_stock
);


-- ============================================================
-- NOTA DE ARQUITECTURA
-- ============================================================
--
-- shared_inventory = fuente operativa de existencias.
--
-- inventory = compatibilidad / histórico.
--
-- Las ventas y compras mantienen branch_id para saber
-- dónde ocurrió la operación, pero NO se duplica stock
-- por sucursal.
--
-- Las dos sucursales consumen el mismo inventario.
--
-- ============================================================