
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !key) {
      return json({ error: "Configuración del servidor incompleta" }, 500);
    }

    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();

    const branchId = String(body.branch_id ?? "");
    const customerName = String(body.customer_name ?? "").trim();
    const customerPhone = String(body.customer_phone ?? "").trim();
    const address = String(body.delivery_address ?? "").trim();
    const notes = String(body.notes ?? "").trim();

    if (!UUID.test(branchId)) {
      return json({ error: "Sucursal no válida" }, 400);
    }

    if (!customerName || customerName.length > 150) {
      return json({ error: "Nombre no válido" }, 400);
    }

    if (!customerPhone || customerPhone.length > 30) {
      return json({ error: "Teléfono no válido" }, 400);
    }

    if (address.length > 500 || notes.length > 1000) {
      return json({ error: "Los datos exceden el límite permitido" }, 400);
    }

    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
      return json({ error: "El carrito no es válido" }, 400);
    }

    const { data: branch, error: branchError } = await admin
      .from("branches")
      .select("id")
      .eq("id", branchId)
      .eq("is_active", true)
      .maybeSingle();

    if (branchError || !branch) {
      return json({ error: "La sucursal no está disponible" }, 400);
    }

    const quantities = new Map<string, number>();

    for (const item of body.items) {
      const id = String(item.product_id ?? "");
      const quantity = Number(item.quantity);

      if (!UUID.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return json({ error: "Producto o cantidad no válida" }, 400);
      }

      quantities.set(id, (quantities.get(id) ?? 0) + quantity);
    }

    const ids = Array.from(quantities.keys());

    const { data: products, error: catalogError } = await admin
      .from("v_online_catalog")
      .select("id, name, price, available_stock")
      .in("id", ids);

    if (catalogError) {
      console.error("Catálogo:", catalogError.message);
      return json({ error: "No se pudo verificar el catálogo" }, 500);
    }

    if (!products || products.length !== ids.length) {
      return json({ error: "Uno o más productos ya no están disponibles" }, 409);
    }

    const orderItems = [];

    for (const product of products) {
      const quantity = quantities.get(product.id) ?? 0;
      const stock = Number(product.available_stock ?? 0);

      if (quantity > stock) {
        return json({
          error: `Existencia insuficiente para ${product.name}. Disponibles: ${stock}`,
        }, 409);
      }

      orderItems.push({
        product_id: product.id,
        name: product.name,
        unit_price: Number(product.price),
        quantity,
      });
    }

    const { data, error } = await admin.rpc("create_online_order", {
      _branch_id: branchId,
      _customer_email: null,
      _customer_id: null,
      _customer_name: customerName,
      _customer_phone: customerPhone,
      _delivery_address: address || null,
      _discount: 0,
      _items: orderItems,
      _notes: notes || null,
    });

    if (error) {
      console.error("create_online_order:", error.message);
      return json({ error: "No se pudo registrar el pedido. Intenta nuevamente." }, 400);
    }

    return json({ success: true, order: data });

  } catch (error) {
    console.error("create-public-online-order:", error);
    return json({ error: "Error interno al procesar el pedido" }, 500);
  }
});
