import type { SupabaseClient } from "@supabase/supabase-js";

export type ParkedSaleCartLine = {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  unit_price: number;
  original_price: number;
  quantity: number;
  discount: number;
  tax_rate: number;
  stock: number;
  sku?: string | null;
  barcode?: string | null;
  emoji?: string | null;
};

export type ParkedSalePaymentMethod =
  | "cash"
  | "card"
  | "transfer"
  | "credit"
  | "mixed";

export type ParkedSaleDraft = {
  id?: string;
  branch_id: string;
  created_by: string;
  label: string | null;
  customer_id: string | null;
  payment_method: ParkedSalePaymentMethod;
  ticket_discount: number;
  cash_received: number | null;
  mixed_cash: number | null;
  mixed_card: number | null;
  notes: string | null;
  cart: ParkedSaleCartLine[];
  created_at?: string;
  updated_at?: string;
};

export type ParkedSaleRow = {
  id: string;
  branch_id: string;
  created_by: string;
  label: string | null;
  customer_id: string | null;
  payment_method: ParkedSalePaymentMethod;
  ticket_discount: number;
  cash_received: number | null;
  mixed_cash: number | null;
  mixed_card: number | null;
  notes: string | null;
  cart: ParkedSaleCartLine[];
  created_at: string;
  updated_at: string;
};

const PARKED_SALE_COLUMNS =
  "id, branch_id, created_by, label, customer_id, payment_method, ticket_discount, cash_received, mixed_cash, mixed_card, notes, cart, created_at, updated_at";

type ParkedSalesClient = SupabaseClient;

export async function createParkedSale(
  client: ParkedSalesClient,
  draft: Omit<
    ParkedSaleDraft,
    "id" | "created_at" | "updated_at"
  >,
): Promise<ParkedSaleRow> {
  const { data, error } = await client
    .from("parked_sales")
    .insert({
      branch_id: draft.branch_id,
      created_by: draft.created_by,
      label: draft.label,
      customer_id: draft.customer_id,
      payment_method: draft.payment_method,
      ticket_discount: draft.ticket_discount,
      cash_received: draft.cash_received,
      mixed_cash: draft.mixed_cash,
      mixed_card: draft.mixed_card,
      notes: draft.notes,
      cart: draft.cart,
    })
    .select(PARKED_SALE_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data as unknown as ParkedSaleRow;
}

export async function listParkedSales(
  client: ParkedSalesClient,
  branchId: string,
): Promise<ParkedSaleRow[]> {
  const { data, error } = await client
    .from("parked_sales")
    .select(PARKED_SALE_COLUMNS)
    .eq("branch_id", branchId)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as ParkedSaleRow[];
}

export async function getParkedSale(
  client: ParkedSalesClient,
  id: string,
): Promise<ParkedSaleRow> {
  const { data, error } = await client
    .from("parked_sales")
    .select(PARKED_SALE_COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data as unknown as ParkedSaleRow;
}

export async function deleteParkedSale(
  client: ParkedSalesClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from("parked_sales")
    .delete()
    .eq("id", id);

  if (error) {
    throw error;
  }
}