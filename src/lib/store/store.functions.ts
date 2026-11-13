
import { createServerFn } from "@tanstack/react-start";

type OnlineCatalogRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  category_id: string | null;
  price: number;
  image_url: string | null;
  emoji: string | null;
  has_variants: boolean;
  available_stock: number;
};

type StoreBranch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
};

type StorePublicData = {
  rows: OnlineCatalogRow[];
  categories: Array<{ id: string; name: string }>;
  branches: StoreBranch[];
  onlineBranchId: string | null;
};

type OrderInput = {
  branchId: string;
  customerName: string;
  customerPhone: string;
  address?: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

async function getAdminClient() {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  return supabaseAdmin;
}

export const getStorePublicData = createServerFn({
  method: "GET",
}).handler(async (): Promise<StorePublicData> => {
  const supabase = await getAdminClient();

  const pageSize = 500;
  let from = 0;
  const rows: OnlineCatalogRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("v_online_catalog")
      .select(
        "id, name, sku, barcode, description, category_id, price, image_url, emoji, has_variants, available_stock",
      )
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[tienda] Error catálogo:", error);
      throw new Error("No fue posible cargar el catálogo.");
    }

    const page = (data ?? []) as OnlineCatalogRow[];
    rows.push(...page);

    if (page.length < pageSize) break;

    from += pageSize;

    if (rows.length >= 20000) break;
  }

  const categoryIds = [
    ...new Set(
      rows
        .map((row) => row.category_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  let categories: Array<{ id: string; name: string }> = [];

  if (categoryIds.length) {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name")
      .in("id", categoryIds);

    if (error) {
      console.error("[tienda] Error categorías:", error);
      throw new Error("No fue posible cargar las categorías.");
    }

    categories = (data ?? []).map((item) => ({
      id: item.id,
      name: item.name,
    }));
  }

  const { data: branches, error: branchError } = await supabase
    .from("branches")
    .select("id, name, address, phone")
    .eq("is_active", true)
    .order("name");

  if (branchError) {
    console.error("[tienda] Error sucursales:", branchError);
    throw new Error("No fue posible consultar las sucursales.");
  }

  const safeBranches = (branches ?? []) as StoreBranch[];

  return {
    rows,
    categories,
    branches: safeBranches,
    onlineBranchId: safeBranches[0]?.id ?? null,
  };
});

export const createStoreOnlineOrder = createServerFn({
  method: "POST",
})
  .inputValidator((input: OrderInput) => input)
  .handler(async ({ data }) => {
    if (!data || !isUuid(data.branchId)) {
      throw new Error("La sucursal seleccionada no es válida.");
    }

    const customerName = cleanText(data.customerName, 120);
    const customerPhone = cleanText(data.customerPhone, 40);
    const address = cleanText(data.address, 500);
    const notes = cleanText(data.notes, 1000);

    if (customerName.length < 2) {
      throw new Error("Escribe tu nombre para continuar.");
    }

    if (customerPhone.length < 7) {
      throw new Error("Escribe un teléfono válido.");
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("El carrito está vacío.");
    }

    if (data.items.length > 100) {
      throw new Error("El pedido supera el límite de artículos.");
    }

    const quantities = new Map<string, number>();

    for (const item of data.items) {
      if (!item || !isUuid(item.productId)) {
        throw new Error("Uno de los productos del pedido no es válido.");
      }

      if (
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      ) {
        throw new Error("Una de las cantidades no es válida.");
      }

      quantities.set(
        item.productId,
        (quantities.get(item.productId) ?? 0) + item.quantity,
      );
    }

    for (const quantity of quantities.values()) {
      if (quantity > 99) {
        throw new Error("La cantidad solicitada supera el límite permitido.");
      }
    }

    const supabase = await getAdminClient();

    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("id")
      .eq("id", data.branchId)
      .eq("is_active", true)
      .maybeSingle();

    if (branchError) {
      console.error("[tienda] Error verificando sucursal:", branchError);
      throw new Error("No fue posible verificar la sucursal.");
    }

    if (!branch) {
      throw new Error("La sucursal ya no está disponible.");
    }

    const productIds = [...quantities.keys()];

    const { data: products, error: productsError } = await supabase
      .from("v_online_catalog")
      .select("id, name, price, available_stock")
      .in("id", productIds);

    if (productsError) {
      console.error("[tienda] Error verificando productos:", productsError);
      throw new Error("No fue posible verificar los productos.");
    }

    const productMap = new Map(
      (products ?? []).map((product) => [product.id, product]),
    );

    const orderItems = productIds.map((productId) => {
      const product = productMap.get(productId);
      const quantity = quantities.get(productId) ?? 0;

      if (!product) {
        throw new Error("Uno de los productos ya no está disponible.");
      }

      const available = Math.max(
        0,
        Number(product.available_stock ?? 0),
      );

      if (quantity > available) {
        throw new Error(
          `Existencia insuficiente para ${product.name}. Disponible: ${available}.`,
        );
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`El precio de ${product.name} no es válido.`);
      }

      return {
        product_id: product.id,
        name: product.name,
        unit_price: price,
        quantity,
      };
    });

    // Se envían todos los parámetros de la función SQL,
    // igual que en el flujo público de pedidos del proyecto.
    const { data: order, error: orderError } = await supabase.rpc(
      "create_online_order",
      {
        _branch_id: data.branchId,
        _customer_email: null,
        _customer_id: null,
        _customer_name: customerName,
        _customer_phone: customerPhone,
        _delivery_address: address || null,
        _discount: 0,
        _items: orderItems,
        _notes: notes || null,
      },
    );

    if (orderError) {
      // El detalle queda en los registros del servidor.
      // No se exponen errores internos de la base de datos al comprador.
      console.error("[tienda] Falló create_online_order:", {
        message: orderError.message,
        code: orderError.code,
        details: orderError.details,
        hint: orderError.hint,
        branchId: data.branchId,
        productIds,
      });

      throw new Error(
        "No se pudo registrar el pedido. Intenta nuevamente.",
      );
    }

    if (!order) {
      console.error("[tienda] La función SQL no devolvió un pedido.");
      throw new Error("No se recibió confirmación del pedido.");
    }

    return order;
  });
