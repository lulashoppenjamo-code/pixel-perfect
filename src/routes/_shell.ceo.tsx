import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Boxes,
  DollarSign,
  Package,
  Receipt,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/ceo")({
  head: () => ({
    meta: [
      {
        title: "CEO — Lula OS",
      },
      {
        name: "description",
        content:
          "Centro ejecutivo de ventas, utilidad, inventario y decisiones de Lula OS.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="ceo">
      <CeoPage />
    </RequireNavAccess>
  ),
});

const rpc = supabase.rpc as any;

const REPORT_TIMEZONE = "America/Mexico_City";

type ReportSummary = {
  sales_total: number;
  tickets: number;
  average_ticket: number;
  historical_cost: number;
  gross_profit: number;
  gross_margin: number;
  expenses_total: number;
  net_profit: number;
  previous_sales_total: number;
  previous_tickets: number;
  previous_average_ticket: number;
  previous_historical_cost: number;
  previous_gross_profit: number;
  previous_gross_margin: number;
  previous_expenses_total: number;
  previous_net_profit: number;
  sales_change_percent: number;
  profit_change_percent: number;
};

type DailySales = {
  day: string;
  sales_total: number;
  tickets: number;
  average_ticket: number;
};

type ProductPerformance = {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  revenue: number;
  historical_cost: number;
  gross_profit: number;
  gross_margin: number;
};

type InventoryRow = {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  stock: number;
  reserved_stock: number;
  available_stock: number;
  min_stock: number;
  max_stock: number | null;
  unit_cost: number;
  unit_price: number;
  inventory_cost: number;
  inventory_retail: number;
  stock_status: string;
};

type PaymentMethodRow = {
  payment_method: string;
  total: number;
  transactions: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

const paymentLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  credit: "Crédito",
  mixed: "Mixto",
};

const QUICK_QUESTIONS = [
  "¿Cómo vamos hoy?",
  "¿Cómo vamos este mes?",
  "¿Qué productos se venden más?",
  "¿Qué productos debo reponer?",
  "¿Cuál es la utilidad?",
  "¿Cuál es mi ticket promedio?",
  "¿Cómo vamos contra el periodo anterior?",
  "¿Qué productos están agotados?",
];

function getMexicoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDateRange(days: number) {
  const to = getMexicoDate();
  const from = format(
    subDays(parseISO(to), days - 1),
    "yyyy-MM-dd",
  );

  return {
    from,
    to,
  };
}

function normalizeNumber(value: unknown): number {
  return Number(value ?? 0);
}

function normalizeSummary(row: any): ReportSummary {
  return {
    sales_total: normalizeNumber(row?.sales_total),
    tickets: normalizeNumber(row?.tickets),
    average_ticket: normalizeNumber(row?.average_ticket),
    historical_cost: normalizeNumber(row?.historical_cost),
    gross_profit: normalizeNumber(row?.gross_profit),
    gross_margin: normalizeNumber(row?.gross_margin),
    expenses_total: normalizeNumber(row?.expenses_total),
    net_profit: normalizeNumber(row?.net_profit),
    previous_sales_total: normalizeNumber(
      row?.previous_sales_total,
    ),
    previous_tickets: normalizeNumber(
      row?.previous_tickets,
    ),
    previous_average_ticket: normalizeNumber(
      row?.previous_average_ticket,
    ),
    previous_historical_cost: normalizeNumber(
      row?.previous_historical_cost,
    ),
    previous_gross_profit: normalizeNumber(
      row?.previous_gross_profit,
    ),
    previous_gross_margin: normalizeNumber(
      row?.previous_gross_margin,
    ),
    previous_expenses_total: normalizeNumber(
      row?.previous_expenses_total,
    ),
    previous_net_profit: normalizeNumber(
      row?.previous_net_profit,
    ),
    sales_change_percent: normalizeNumber(
      row?.sales_change_percent,
    ),
    profit_change_percent: normalizeNumber(
      row?.profit_change_percent,
    ),
  };
}

function CeoPage() {
  const { branchId, branches } = useBranch();

  const [rangeDays, setRangeDays] = useState("30");

  const [input, setInput] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text:
        "Hola. Soy el Centro Ejecutivo de Lula OS.\n\n" +
        "Estoy conectado a los datos reales de ventas, costos, utilidad e inventario compartido.\n\n" +
        "Pregúntame cómo va el negocio, qué productos vender, qué reponer o cómo están tus utilidades.",
    },
  ]);

  const [thinking, setThinking] = useState(false);

  const selectedBranchName =
    branches.find(
      (branch) => branch.id === branchId,
    )?.name ?? "Sucursal activa";

  const range = useMemo(
    () => getDateRange(Number(rangeDays)),
    [rangeDays],
  );

  const todayRange = useMemo(
    () => getDateRange(1),
    [],
  );

  const yesterdayRange = useMemo(() => {
    const today = parseISO(getMexicoDate());
    const yesterday = format(
      subDays(today, 1),
      "yyyy-MM-dd",
    );

    return {
      from: yesterday,
      to: yesterday,
    };
  }, []);

  const monthRange = useMemo(() => {
    const today = parseISO(getMexicoDate());

    return {
      from: format(
        new Date(
          today.getFullYear(),
          today.getMonth(),
          1,
        ),
        "yyyy-MM-dd",
      ),
      to: format(today, "yyyy-MM-dd"),
    };
  }, []);

  /*
   * ============================================================
   * RESUMEN PRINCIPAL
   * ============================================================
   */

  const {
    data: summary,
    isLoading: loadingSummary,
    error: summaryError,
  } = useQuery<ReportSummary>({
    queryKey: [
      "ceo",
      "summary",
      branchId,
      range.from,
      range.to,
    ],

    enabled: Boolean(branchId),

    queryFn: async () => {
      const { data, error } = await rpc(
        "get_reports_summary",
        {
          _from: range.from,
          _to: range.to,
          _branch_id: branchId,
          _timezone: REPORT_TIMEZONE,
        },
      );

      if (error) {
        throw error;
      }

      const row = Array.isArray(data)
        ? data[0]
        : data;

      return normalizeSummary(row);
    },
  });

  /*
   * ============================================================
   * HOY
   * ============================================================
   */

  const { data: todaySummary } =
    useQuery<ReportSummary>({
      queryKey: [
        "ceo",
        "today",
        branchId,
        todayRange.from,
      ],

      enabled: Boolean(branchId),

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_summary",
          {
            _from: todayRange.from,
            _to: todayRange.to,
            _branch_id: branchId,
            _timezone: REPORT_TIMEZONE,
          },
        );

        if (error) {
          throw error;
        }

        const row = Array.isArray(data)
          ? data[0]
          : data;

        return normalizeSummary(row);
      },
    });

  /*
   * ============================================================
   * AYER
   * ============================================================
   */

  const { data: yesterdaySummary } =
    useQuery<ReportSummary>({
      queryKey: [
        "ceo",
        "yesterday",
        branchId,
        yesterdayRange.from,
      ],

      enabled: Boolean(branchId),

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_summary",
          {
            _from: yesterdayRange.from,
            _to: yesterdayRange.to,
            _branch_id: branchId,
            _timezone: REPORT_TIMEZONE,
          },
        );

        if (error) {
          throw error;
        }

        const row = Array.isArray(data)
          ? data[0]
          : data;

        return normalizeSummary(row);
      },
    });

  /*
   * ============================================================
   * MES
   * ============================================================
   */

  const { data: monthSummary } =
    useQuery<ReportSummary>({
      queryKey: [
        "ceo",
        "month",
        branchId,
        monthRange.from,
        monthRange.to,
      ],

      enabled: Boolean(branchId),

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_summary",
          {
            _from: monthRange.from,
            _to: monthRange.to,
            _branch_id: branchId,
            _timezone: REPORT_TIMEZONE,
          },
        );

        if (error) {
          throw error;
        }

        const row = Array.isArray(data)
          ? data[0]
          : data;

        return normalizeSummary(row);
      },
    });

  /*
   * ============================================================
   * VENTAS DIARIAS
   * ============================================================
   */

  const { data: dailySales = [] } =
    useQuery<DailySales[]>({
      queryKey: [
        "ceo",
        "daily-sales",
        branchId,
        range.from,
        range.to,
      ],

      enabled: Boolean(branchId),

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_daily_sales",
          {
            _from: range.from,
            _to: range.to,
            _branch_id: branchId,
            _timezone: REPORT_TIMEZONE,
          },
        );

        if (error) {
          throw error;
        }

        return (data ?? []).map(
          (row: any) => ({
            day: String(row.day),
            sales_total: normalizeNumber(
              row.sales_total,
            ),
            tickets: normalizeNumber(
              row.tickets,
            ),
            average_ticket:
              normalizeNumber(
                row.average_ticket,
              ),
          }),
        );
      },
    });

  /*
   * ============================================================
   * PRODUCTOS
   * ============================================================
   */

  const { data: products = [] } =
    useQuery<ProductPerformance[]>({
      queryKey: [
        "ceo",
        "products",
        branchId,
        range.from,
        range.to,
      ],

      enabled: Boolean(branchId),

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_product_performance",
          {
            _from: range.from,
            _to: range.to,
            _branch_id: branchId,
            _limit: 50,
            _timezone: REPORT_TIMEZONE,
          },
        );

        if (error) {
          throw error;
        }

        return (data ?? []).map(
          (row: any) => ({
            product_id:
              row.product_id ?? null,
            variant_id:
              row.variant_id ?? null,
            product_name: String(
              row.product_name ??
                "Producto sin nombre",
            ),
            quantity: normalizeNumber(
              row.quantity,
            ),
            revenue: normalizeNumber(
              row.revenue,
            ),
            historical_cost:
              normalizeNumber(
                row.historical_cost,
              ),
            gross_profit:
              normalizeNumber(
                row.gross_profit,
              ),
            gross_margin:
              normalizeNumber(
                row.gross_margin,
              ),
          }),
        );
      },
    });

  /*
   * ============================================================
   * INVENTARIO GLOBAL
   * ============================================================
   *
   * IMPORTANTE:
   * NO lleva branch_id.
   *
   * Lula Shop maneja inventario compartido.
   */

  const { data: inventory = [] } =
    useQuery<InventoryRow[]>({
      queryKey: [
        "ceo",
        "inventory",
      ],

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_inventory",
        );

        if (error) {
          throw error;
        }

        return (data ?? []).map(
          (row: any) => ({
            product_id: String(
              row.product_id,
            ),
            variant_id:
              row.variant_id ?? null,
            product_name: String(
              row.product_name ??
                "Producto sin nombre",
            ),
            sku:
              row.sku ?? null,
            barcode:
              row.barcode ?? null,
            stock: normalizeNumber(
              row.stock,
            ),
            reserved_stock:
              normalizeNumber(
                row.reserved_stock,
              ),
            available_stock:
              normalizeNumber(
                row.available_stock,
              ),
            min_stock:
              normalizeNumber(
                row.min_stock,
              ),
            max_stock:
              row.max_stock == null
                ? null
                : normalizeNumber(
                    row.max_stock,
                  ),
            unit_cost:
              normalizeNumber(
                row.unit_cost,
              ),
            unit_price:
              normalizeNumber(
                row.unit_price,
              ),
            inventory_cost:
              normalizeNumber(
                row.inventory_cost,
              ),
            inventory_retail:
              normalizeNumber(
                row.inventory_retail,
              ),
            stock_status: String(
              row.stock_status ??
                "ok",
            ),
          }),
        );
      },
    });

  /*
   * ============================================================
   * MÉTODOS DE PAGO
   * ============================================================
   */

  const { data: payments = [] } =
    useQuery<PaymentMethodRow[]>({
      queryKey: [
        "ceo",
        "payments",
        branchId,
        range.from,
        range.to,
      ],

      enabled: Boolean(branchId),

      queryFn: async () => {
        const { data, error } = await rpc(
          "get_reports_payment_methods",
          {
            _from: range.from,
            _to: range.to,
            _branch_id: branchId,
            _timezone: REPORT_TIMEZONE,
          },
        );

        if (error) {
          throw error;
        }

        return (data ?? []).map(
          (row: any) => ({
            payment_method: String(
              row.payment_method ??
                "cash",
            ),
            total: normalizeNumber(
              row.total,
            ),
            transactions:
              normalizeNumber(
                row.transactions,
              ),
          }),
        );
      },
    });

  /*
   * ============================================================
   * DATOS CALCULADOS
   * ============================================================
   */

  const inventoryStats = useMemo(() => {
    const units = inventory.reduce(
      (sum, item) =>
        sum + item.stock,
      0,
    );

    const available = inventory.reduce(
      (sum, item) =>
        sum + item.available_stock,
      0,
    );

    const reserved = inventory.reduce(
      (sum, item) =>
        sum + item.reserved_stock,
      0,
    );

    const cost = inventory.reduce(
      (sum, item) =>
        sum + item.inventory_cost,
      0,
    );

    const retail = inventory.reduce(
      (sum, item) =>
        sum + item.inventory_retail,
      0,
    );

    const lowStock = inventory.filter(
      (item) =>
        item.stock_status ===
          "low_stock" ||
        item.stock_status ===
          "out_of_stock",
    );

    const outOfStock =
      inventory.filter(
        (item) =>
          item.stock_status ===
          "out_of_stock",
      );

    return {
      units,
      available,
      reserved,
      cost,
      retail,
      potentialProfit:
        retail - cost,
      lowStock,
      outOfStock,
    };
  }, [inventory]);

  const chartData = useMemo(
    () =>
      dailySales.map(
        (row) => ({
          ...row,
          label: format(
            parseISO(row.day),
            "dd/MM",
          ),
        }),
      ),
    [dailySales],
  );

  const topProducts = products.slice(
    0,
    10,
  );

  const topMargins = [...products]
    .sort(
      (a, b) =>
        b.gross_margin -
        a.gross_margin,
    )
    .slice(0, 8);

  /*
   * ============================================================
   * CHAT CEO
   * ============================================================
   */

  const answerQuestion = (
    question: string,
  ): string => {
    const text = question
      .toLowerCase()
      .normalize("NFD")
      .replace(
        /\p{Diacritic}/gu,
        "",
      );

    const current =
      summary ?? {
        sales_total: 0,
        tickets: 0,
        average_ticket: 0,
        historical_cost: 0,
        gross_profit: 0,
        gross_margin: 0,
        expenses_total: 0,
        net_profit: 0,
        previous_sales_total: 0,
        previous_tickets: 0,
        previous_average_ticket: 0,
        previous_historical_cost: 0,
        previous_gross_profit: 0,
        previous_gross_margin: 0,
        previous_expenses_total: 0,
        previous_net_profit: 0,
        sales_change_percent: 0,
        profit_change_percent: 0,
      };

    if (
      text.includes("hoy") ||
      text.includes("dia")
    ) {
      return (
        `VENTAS DE HOY\n\n` +
        `Sucursal: ${selectedBranchName}\n` +
        `Ventas: ${money(
          todaySummary?.sales_total ??
            0,
        )}\n` +
        `Tickets: ${
          todaySummary?.tickets ??
          0
        }\n` +
        `Ticket promedio: ${money(
          todaySummary
            ?.average_ticket ??
            0,
        )}`
      );
    }

    if (
      text.includes("mes") ||
      text.includes(
        "este mes",
      )
    ) {
      return (
        `RESULTADO DEL MES\n\n` +
        `Ventas: ${money(
          monthSummary?.sales_total ??
            0,
        )}\n` +
        `Tickets: ${
          monthSummary?.tickets ??
          0
        }\n` +
        `Ticket promedio: ${money(
          monthSummary
            ?.average_ticket ??
            0,
        )}\n` +
        `Utilidad bruta: ${money(
          monthSummary
            ?.gross_profit ??
            0,
        )}\n` +
        `Utilidad neta: ${money(
          monthSummary?.net_profit ??
            0,
        )}`
      );
    }

    if (
      text.includes("ticket")
    ) {
      return (
        `TICKET PROMEDIO\n\n` +
        `Periodo seleccionado: ${money(
          current.average_ticket,
        )}\n` +
        `Tickets analizados: ${current.tickets}\n\n` +
        `Anterior: ${money(
          current.previous_average_ticket,
        )}`
      );
    }

    if (
      text.includes(
        "mas vendidos",
      ) ||
      text.includes(
        "vendiendo mas",
      ) ||
      text.includes(
        "productos",
      ) &&
        text.includes("vende")
    ) {
      if (!topProducts.length) {
        return "Todavía no hay datos suficientes de ventas para analizar productos.";
      }

      return (
        `PRODUCTOS MÁS VENDIDOS\n\n` +
        topProducts
          .map(
            (product, index) =>
              `${index + 1}. ${
                product.product_name
              } — ${
                product.quantity
              } uds — ${money(
                product.revenue,
              )}`,
          )
          .join("\n")
      );
    }

    if (
      text.includes(
        "comprar",
      ) ||
      text.includes(
        "reponer",
      ) ||
      text.includes(
        "pedido",
      ) ||
      text.includes(
        "agot"
      ) ||
      text.includes(
        "stock bajo",
      )
    ) {
      if (
        !inventoryStats.lowStock
          .length
      ) {
        return "No hay productos bajo el mínimo configurado.";
      }

      return (
        `PRODUCTOS PARA REVISAR / REPONER\n\n` +
        inventoryStats.lowStock
          .slice(0, 15)
          .map((item) => {
            const missing =
              Math.max(
                item.min_stock -
                  item.available_stock,
                0,
              );

            return (