import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Boxes,
  DollarSign,
  RefreshCw,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  subDays,
  startOfDay,
  startOfMonth,
} from "date-fns";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { getSharedInventory } from "@/lib/sharedInventory";

import {
  buildCeoAnalysis,
  type CeoExpense,
  type CeoInventoryItem,
  type CeoProduct,
  type CeoSale,
  type CeoSaleItem,
} from "@/lib/ceoAnalysis";

export const Route = createFileRoute("/_shell/ceo")({
  head: () => ({
    meta: [
      { title: "CEO IA — Lula OS" },
      {
        name: "description",
        content:
          "Centro ejecutivo de ventas, utilidad, inventario y análisis de Lula OS.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="ceo">
      <CeoPage />
    </RequireNavAccess>
  ),
});

type Message = {
  role: "user" | "assistant";
  text: string;
};

const SUGGESTIONS = [
  "¿Cómo están las ventas hoy?",
  "¿Cómo vamos este mes?",
  "¿Cómo vamos esta semana?",
  "¿Cuál es la utilidad real?",
  "¿Qué productos venden más?",
  "¿Qué productos generan más utilidad?",
  "¿Qué productos están por agotarse?",
  "¿Qué debo comprar?",
  "¿Cuál es el ticket promedio?",
  "¿Qué productos tienen mayor margen?",
  "¿Qué productos están estancados?",
  "¿Cómo vamos contra el periodo anterior?",
  "Dame un resumen ejecutivo",
  "¿Cómo está mi inventario?",
];

function normalizeQuestion(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function CeoPage() {
  const { branchId, branches } = useBranch();
  const queryClient = useQueryClient();

  const branchName =
    branches.find(
      (branch) => branch.id === branchId,
    )?.name ?? "Sucursal";

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [now, setNow] = useState(
    () => new Date(),
  );

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        `Hola. Soy el CEO IA de LULA OS.\n\n` +
        `Estoy conectado a ventas, costos históricos, gastos e inventario compartido.\n\n` +
        `Ahora puedo analizar ventas de hoy, ayer, semana y 30 días; utilidad, márgenes, inventario, productos estancados y reposición.`,
    },
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () =>
      window.clearInterval(interval);
  }, []);

  const todayStart = useMemo(
    () =>
      startOfDay(now).toISOString(),
    [now],
  );

  const monthStart = useMemo(
    () =>
      startOfMonth(now).toISOString(),
    [now],
  );

  const since30 = useMemo(
    () =>
      startOfDay(
        subDays(now, 29),
      ).toISOString(),
    [now],
  );

  const since60 = useMemo(
    () =>
      startOfDay(
        subDays(now, 59),
      ).toISOString(),
    [now],
  );

  const todayDate = useMemo(
    () =>
      now
        .toISOString()
        .slice(0, 10),
    [now],
  );

  const {
    data: salesToday = [],
    isLoading: loadingToday,
    isFetching: fetchingToday,
  } = useQuery({
    queryKey: [
      "ceo",
      "sales-today",
      branchId,
      todayStart,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sales")
          .select(
            "id,total,created_at",
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .eq(
            "status",
            "completed",
          )
          .gte(
            "created_at",
            todayStart,
          )
          .order(
            "created_at",
            {
              ascending: true,
            },
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as CeoSale[];
    },
  });

  const {
    data: sales30 = [],
    isLoading: loadingSales30,
    isFetching: fetchingSales30,
  } = useQuery({
    queryKey: [
      "ceo",
      "sales-30",
      branchId,
      since30,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sales")
          .select(
            "id,total,created_at",
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .eq(
            "status",
            "completed",
          )
          .gte(
            "created_at",
            since30,
          )
          .order(
            "created_at",
            {
              ascending: true,
            },
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as CeoSale[];
    },
  });

  const {
    data: salesPrevious = [],
    isFetching: fetchingPrevious,
  } = useQuery({
    queryKey: [
      "ceo",
      "sales-previous",
      branchId,
      since60,
      since30,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sales")
          .select(
            "id,total,created_at",
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .eq(
            "status",
            "completed",
          )
          .gte(
            "created_at",
            since60,
          )
          .lt(
            "created_at",
            since30,
          )
          .order(
            "created_at",
            {
              ascending: true,
            },
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as CeoSale[];
    },
  });

  const {
    data: salesMonth = [],
    isFetching: fetchingMonth,
  } = useQuery({
    queryKey: [
      "ceo",
      "sales-month",
      branchId,
      monthStart,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sales")
          .select(
            "id,total,created_at",
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .eq(
            "status",
            "completed",
          )
          .gte(
            "created_at",
            monthStart,
          )
          .order(
            "created_at",
            {
              ascending: true,
            },
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as CeoSale[];
    },
  });

  const saleIds = useMemo(
    () =>
      sales30.map(
        (sale) => sale.id,
      ),
    [sales30],
  );

  const {
    data: saleItems = [],
    isFetching: fetchingSaleItems,
  } = useQuery({
    queryKey: [
      "ceo",
      "sale-items",
      saleIds.join(","),
    ],
    enabled:
      saleIds.length > 0,
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sale_items")
          .select(
            `
              sale_id,
              name_snapshot,
              quantity,
              total,
              product_id,
              variant_id,
              unit_cost,
              cost_total
            `,
          )
          .in(
            "sale_id",
            saleIds,
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as CeoSaleItem[];
    },
  });

  const {
    data: inventory = [],
    isFetching: fetchingInventory,
  } = useQuery({
    queryKey: [
      "ceo",
      "shared-inventory",
    ],
    queryFn: async () => {
      return getSharedInventory();
    },
  });

  const {
    data: products = [],
    isFetching: fetchingProducts,
  } = useQuery({
    queryKey: [
      "ceo",
      "products",
    ],
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("products")
          .select(
            "id,name,cost,price",
          )
          .eq(
            "is_active",
            true,
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as CeoProduct[];
    },
  });

  const {
    data: expenses = [],
    isFetching: fetchingExpenses,
  } = useQuery({
    queryKey: [
      "ceo",
      "expenses",
      branchId,
      since30,
      todayDate,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const startDate =
        since30.slice(0, 10);

      const { data, error } =
        await supabase
          .from("expenses")
          .select("amount")
          .eq(
            "branch_id",
            branchId!,
          )
          .gte(
            "expense_date",
            startDate,
          )
          .lte(
            "expense_date",
            todayDate,
          );

      if (error) {
        if (
          error.code ===
            "42P01" ||
          error.message?.includes(
            "does not exist",
          )
        ) {
          return [] as CeoExpense[];
        }

        throw error;
      }

      return (data ??
        []) as CeoExpense[];
    },
  });

  const analysis = useMemo(
    () =>
      buildCeoAnalysis({
        now,
        salesToday,
        sales30,
        salesPrevious,
        salesMonth,
        saleItems,
        inventory:
          inventory as CeoInventoryItem[],
        products,
        expenses,
      }),
    [
      now,
      salesToday,
      sales30,
      salesPrevious,
      salesMonth,
      saleItems,
      inventory,
      products,
      expenses,
    ],
  );

  const handleRefresh =
    async () => {
      setNow(new Date());

      await queryClient.invalidateQueries(
        {
          queryKey: ["ceo"],
        },
      );
    };

  const refreshing =
    fetchingToday ||
    fetchingSales30 ||
    fetchingPrevious ||
    fetchingMonth ||
    fetchingSaleItems ||
    fetchingInventory ||
    fetchingProducts ||
    fetchingExpenses;

  const answer = (
    question: string,
  ) => {
    const text =
      normalizeQuestion(
        question,
      );

    if (
      text.includes("resumen") ||
      text.includes("como vamos") ||
      text.includes("como van")
    ) {
      return (
        `RESUMEN EJECUTIVO — ${branchName}\n\n` +
        `Hoy: ${money(
          analysis.todaySales,
        )} en ${
          analysis.todayTickets
        } tickets\n` +
        `Ayer: ${money(
          analysis.yesterdaySales,
        )} en ${
          analysis.yesterdayTickets
        } tickets\n\n` +
        `Últimos 7 días: ${money(
          analysis.last7Sales,
        )}\n` +
        `Variación semanal: ${
          analysis.change7 >= 0
            ? "+"
            : ""
        }${analysis.change7.toFixed(
          1,
        )}%\n\n` +
        `Últimos 30 días: ${money(
          analysis.last30Sales,
        )}\n` +
        `Variación 30 días: ${
          analysis.change >= 0
            ? "+"
            : ""
        }${analysis.change.toFixed(
          1,
        )}%\n\n` +
        `Utilidad bruta: ${money(
          analysis.grossProfit,
        )}\n` +
        `Margen bruto: ${analysis.margin.toFixed(
          1,
        )}%\n` +
        `Gastos: ${money(
          analysis.expensesTotal,
        )}\n` +
        `Utilidad neta: ${money(
          analysis.netProfit,
        )}\n\n` +
        `Inventario: ${analysis.inventoryUnits.toLocaleString(
          "es-MX",
        )} uds\n` +
        `Agotados: ${analysis.outOfStock.length}\n` +
        `Bajo mínimo: ${analysis.lowStock.length}`
      );
    }

    if (
      text.includes("ayer")
    ) {
      return (
        `VENTAS DE AYER — ${branchName}\n\n` +
        `Ventas: ${money(
          analysis.yesterdaySales,
        )}\n` +
        `Tickets: ${analysis.yesterdayTickets}\n` +
        `Ticket promedio: ${money(
          analysis.yesterdayAverageTicket,
        )}`
      );
    }

    if (
      text.includes("hoy") &&
      (
        text.includes("venta") ||
        text.includes("vend") ||
        text.includes("como")
      )
    ) {
      return (
        `VENTAS DE HOY — ${branchName}\n\n` +
        `Ventas: ${money(
          analysis.todaySales,
        )}\n` +
        `Tickets: ${analysis.todayTickets}\n` +
        `Ticket promedio: ${money(
          analysis.todayAverageTicket,
        )}\n\n` +
        `Ayer: ${money(
          analysis.yesterdaySales,
        )}\n` +
        `Cambio contra ayer: ${
          analysis.todaySales >=
          analysis.yesterdaySales
            ? "+"
            : ""
        }${
          analysis.yesterdaySales > 0
            ? (
                ((analysis.todaySales -
                  analysis.yesterdaySales) /
                  analysis.yesterdaySales) *
                100
              ).toFixed(1)
            : "0.0"
        }%`
      );
    }

    if (
      text.includes("semana") ||
      text.includes("7 dias")
    ) {
      return (
        `VENTAS — ÚLTIMOS 7 DÍAS\n\n` +
        `Ventas: ${money(
          analysis.last7Sales,
        )}\n` +
        `Tickets: ${analysis.tickets7}\n` +
        `Ticket promedio: ${money(
          analysis.tickets7 > 0
            ? analysis.last7Sales /
                analysis.tickets7
            : 0,
        )}\n\n` +
        `Periodo anterior: ${money(
          analysis.previous7Sales,
        )}\n` +
        `Variación: ${
          analysis.change7 >= 0
            ? "+"
            : ""
        }${analysis.change7.toFixed(
          1,
        )}%`
      );
    }

    if (
      text.includes("mes") &&
      !text.includes("anterior")
    ) {
      return (
        `VENTAS DEL MES\n\n` +
        `Ingresos: ${money(
          analysis.monthSales,
        )}\n` +
        `Tickets: ${analysis.monthTickets}\n` +
        `