import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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

  const branchName =
    branches.find(
      (branch) => branch.id === branchId,
    )?.name ?? "Sucursal";

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        `Hola. Soy el CEO IA de LULA OS.\n\n` +
        `Estoy conectado a ventas, costos históricos, gastos e inventario compartido.\n\n` +
        `Ahora puedo analizar ventas de hoy, ayer, semana y 30 días; utilidad, márgenes, inventario, productos estancados y reposición.`,
    },
  ]);

  const now = new Date();

  const todayStart = useMemo(
    () => startOfDay(now).toISOString(),
    [],
  );

  const monthStart = useMemo(
    () => startOfMonth(now).toISOString(),
    [],
  );

  const since30 = useMemo(
    () =>
      startOfDay(
        subDays(now, 29),
      ).toISOString(),
    [],
  );

  const since60 = useMemo(
    () =>
      startOfDay(
        subDays(now, 59),
      ).toISOString(),
    [],
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
          .select("id,total,created_at")
          .eq("branch_id", branchId!)
          .eq("status", "completed")
          .gte("created_at", todayStart)
          .order("created_at", {
            ascending: true,
          });

      if (error) {
        throw error;
      }

      return (data ?? []) as CeoSale[];
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
          .select("id,total,created_at")
          .eq("branch_id", branchId!)
          .eq("status", "completed")
          .gte("created_at", since30)
          .order("created_at", {
            ascending: true,
          });

      if (error) {
        throw error;
      }

      return (data ?? []) as CeoSale[];
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
          .select("id,total,created_at")
          .eq("branch_id", branchId!)
          .eq("status", "completed")
          .gte("created_at", since60)
          .lt("created_at", since30)
          .order("created_at", {
            ascending: true,
          });

      if (error) {
        throw error;
      }

      return (data ?? []) as CeoSale[];
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
          .select("id,total,created_at")
          .eq("branch_id", branchId!)
          .eq("status", "completed")
          .gte("created_at", monthStart)
          .order("created_at", {
            ascending: true,
          });

      if (error) {
        throw error;
      }

      return (data ?? []) as CeoSale[];
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
    enabled: saleIds.length > 0,
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
          .in("sale_id", saleIds);

      if (error) {
        throw error;
      }

      return (data ?? []) as CeoSaleItem[];
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
          .select("id,name,cost,price")
          .eq("is_active", true);

      if (error) {
        throw error;
      }

      return (data ?? []) as CeoProduct[];
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
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const startDate =
        since30.slice(0, 10);

      const todayDate =
        new Date()
          .toISOString()
          .slice(0, 10);

      const { data, error } =
        await supabase
          .from("expenses")
          .select("amount")
          .eq("branch_id", branchId!)
          .gte("expense_date", startDate)
          .lte("expense_date", todayDate);

      if (error) {
        if (
          error.code === "42P01" ||
          error.message?.includes(
            "does not exist",
          )
        ) {
          return [] as CeoExpense[];
        }

        throw error;
      }

      return (data ?? []) as CeoExpense[];
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
      normalizeQuestion(question);

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
        `Ticket promedio: ${money(
          analysis.monthTickets > 0
            ? analysis.monthSales /
                analysis.monthTickets
            : 0,
        )}`
      );
    }

    if (
      text.includes("ticket")
    ) {
      return (
        `TICKET PROMEDIO\n\n` +
        `Últimos 30 días: ${money(
          analysis.averageTicket,
        )}\n` +
        `Hoy: ${money(
          analysis.todayAverageTicket,
        )}\n` +
        `Ayer: ${money(
          analysis.yesterdayAverageTicket,
        )}\n` +
        `Unidades por ticket: ${analysis.averageUnitsPerSale.toFixed(
          1,
        )}`
      );
    }

    if (
      text.includes("mas vendidos") ||
      text.includes("vendiendo mas") ||
      text.includes("que se vende")
    ) {
      if (
        !analysis.topProducts.length
      ) {
        return "No hay ventas suficientes para analizar productos.";
      }

      return (
        `PRODUCTOS MÁS VENDIDOS — 30 DÍAS\n\n` +
        analysis.topProducts
          .slice(0, 10)
          .map(
            (
              product,
              index,
            ) =>
              `${index + 1}. ${
                product.name
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
      text.includes("mayor margen") ||
      text.includes("mejor margen")
    ) {
      if (
        !analysis.catalogMargins.length
      ) {
        return "No hay productos con precio válido para calcular margen.";
      }

      return (
        `PRODUCTOS CON MAYOR MARGEN DEL CATÁLOGO\n\n` +
        analysis.catalogMargins
          .slice(0, 10)
          .map(
            (
              product,
              index,
            ) =>
              `${index + 1}. ${
                product.name
              } — ${product.margin.toFixed(
                1,
              )}%`,
          )
          .join("\n")
      );
    }

    if (
      text.includes("mas utilidad") ||
      text.includes("mayor utilidad") ||
      text.includes("ganan mas")
    ) {
      if (
        !analysis.topProfitProducts
          .length
      ) {
        return "No hay suficiente información de costos históricos para analizar utilidad por producto.";
      }

      return (
        `PRODUCTOS QUE MÁS GENERARON UTILIDAD — 30 DÍAS\n\n` +
        analysis.topProfitProducts
          .slice(0, 10)
          .map(
            (
              product,
              index,
            ) =>
              `${index + 1}. ${
                product.name
              } — utilidad ${money(
                product.profit,
              )} — margen ${product.margin.toFixed(
                1,
              )}%`,
          )
          .join("\n")
      );
    }

    if (
      text.includes("utilidad") ||
      text.includes("ganancia") ||
      text.includes("margen")
    ) {
      return (
        `UTILIDAD REAL — 30 DÍAS\n\n` +
        `Ingresos: ${money(
          analysis.revenue,
        )}\n` +
        `Costo histórico: ${money(
          analysis.historicalCost,
        )}\n` +
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
        `El costo utiliza el costo histórico guardado en cada venta.`
      );
    }

    if (
      text.includes("anterior") ||
      text.includes("compar") ||
      text.includes("periodo") ||
      text.includes("vs")
    ) {
      return (
        `COMPARACIÓN — PERIODOS DE 30 DÍAS\n\n` +
        `Periodo actual: ${money(
          analysis.last30Sales,
        )}\n` +
        `Periodo anterior: ${money(
          analysis.previousSales,
        )}\n` +
        `Tickets actuales: ${analysis.tickets30}\n` +
        `Tickets anteriores: ${analysis.previousTickets}\n` +
        `Variación: ${
          analysis.change >= 0
            ? "+"
            : ""
        }${analysis.change.toFixed(
          1,
        )}%`
      );
    }

    if (
      text.includes("comprar") ||
      text.includes("reponer") ||
      text.includes("pedir") ||
      text.includes("pedido")
    ) {
      if (
        !analysis.replenishment.length
      ) {
        return "No hay alertas de reposición basadas en los mínimos configurados.";
      }

      return (
        `SUGERENCIA DE REPOSICIÓN\n\n` +
        analysis.replenishment
          .slice(0, 15)
          .map(
            (item) =>
              `• ${item.name}: ` +
              `${item.available} disponibles, ` +
              `${item.unitsSold30} vendidos/30 días, ` +
              `${
                item.daysOfStock !== null
                  ? `${item.daysOfStock.toFixed(
                      1,
                    )} días estimados, `
                  : ""
              }` +
              `sugerido ${item.suggestedUnits} uds ` +
              `(${money(
                item.estimatedCost,
              )} a costo)`,
          )
          .join("\n")
      );
    }

    if (
      text.includes("agot")
    ) {
      if (
        !analysis.outOfStock.length
      ) {
        return "No hay productos agotados actualmente.";
      }

      return (
        `PRODUCTOS AGOTADOS\n\n` +
        analysis.outOfStock
          .slice(0, 20)
          .map(
            (item) =>
              `• ${item.product_name}`,
          )
          .join("\n")
      );
    }

    if (
      text.includes("stock") ||
      text.includes("inventario") ||
      text.includes("minimo")
    ) {
      if (
        text.includes("inventario") &&
        !text.includes("agot")
      ) {
        return (
          `INVENTARIO CENTRAL\n\n` +
          `Existencia: ${analysis.inventoryUnits.toLocaleString(
            "es-MX",
          )} uds\n` +
          `Disponible: ${analysis.inventoryAvailable.toLocaleString(
            "es-MX",
          )} uds\n` +
          `Reservado: ${analysis.inventoryReserved.toLocaleString(
            "es-MX",
          )} uds\n` +
          `Valor a costo: ${money(
            analysis.inventoryCost,
          )}\n` +
          `Valor de venta: ${money(
            analysis.inventoryRetail,
          )}\n` +
          `Cobertura: ${analysis.inventoryCoverage.toFixed(
            1,
          )}x\n` +
          `Agotados: ${analysis.outOfStock.length}\n` +
          `Bajo mínimo: ${analysis.lowStock.length}`
        );
      }

      const rows =
        analysis.lowStock.slice(0, 15);

      if (!rows.length) {
        return "No hay productos bajo el mínimo configurado.";
      }

      return (
        `ALERTAS DE INVENTARIO\n\n` +
        `Agotados: ${analysis.outOfStock.length}\n` +
        `Bajo mínimo: ${analysis.lowStock.length}\n\n` +
        rows
          .map(
            (item) =>
              `• ${item.product_name}: ${item.available_stock} disponibles / mínimo ${item.min_stock}`,
          )
          .join("\n")
      );
    }

    if (
      text.includes("estanc") ||
      text.includes("no se vende") ||
      text.includes("parado")
    ) {
      if (
        !analysis.stagnant.length
      ) {
        return "No detecté productos con existencia disponible que no hayan aparecido en las ventas de los últimos 30 días.";
      }

      return (
        `PRODUCTOS SIN MOVIMIENTO — 30 DÍAS\n\n` +
        analysis.stagnant
          .slice(0, 20)
          .map(
            (item) =>
              `• ${item.product_name} — disponible ${item.available_stock}`,
          )
          .join("\n")
      );
    }

    return (
      `Puedo analizar:\n\n` +
      `• Ventas de hoy y ayer\n` +
      `• Ventas de la semana\n` +
      `• Ventas del mes\n` +
      `• Últimos 30 días\n` +
      `• Comparación contra periodo anterior\n` +
      `• Ticket promedio\n` +
      `• Unidades por ticket\n` +
      `• Utilidad bruta y neta\n` +
      `• Costos históricos\n` +
      `• Gastos\n` +
      `• Márgenes\n` +
      `• Productos más vendidos\n` +
      `• Productos que más utilidad generan\n` +
      `• Productos bajo mínimo\n` +
      `• Productos agotados\n` +
      `• Reposición sugerida\n` +
      `• Inventario central\n` +
      `• Productos sin movimiento`
    );
  };

  const ask = (
    question: string,
  ) => {
    const value = question.trim();

    if (
      !value ||
      thinking
    ) {
      return;
    }

    setMessages(
      (current) => [
        ...current,
        {
          role: "user",
          text: value,
        },
      ],
    );

    setInput("");
    setThinking(true);

    window.setTimeout(() => {
      setMessages(
        (current) => [
          ...current,
          {
            role: "assistant",
            text: answer(value),
          },
        ],
      );

      setThinking(false);
    }, 200);
  };

  const salesChangeText =
    `${
      analysis.change >= 0
        ? "+"
        : ""
    }${analysis.change.toFixed(
      1,
    )}%`;

  const weeklyChangeText =
    `${
      analysis.change7 >= 0
        ? "+"
        : ""
    }${analysis.change7.toFixed(
      1,
    )}%`;

  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-0 flex-col p-3 sm:p-4 md:h-[calc(100vh-1rem)] md:p-6">
      <PageHeader
        icon={Bot}
        title="CEO IA"
        description={`Centro de inteligencia de LULA OS — ${branchName}`}
        className="mb-4 shrink-0"
      />

      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="gap-1"
          >
            <Sparkles className="h-3 w-3" />
            Motor CEO local
          </Badge>

          <span className="hidden text-xs text-muted-foreground sm:inline">
            Datos reales del sistema
          </span>
        </div>

        <div className="flex items-center gap-2">
          {refreshing && (
            <span className="text-xs text-muted-foreground">
              Actualizando…
            </span>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
            className="gap-2"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                refreshing &&
                  "animate-spin",
              )}
            />
            <span className="hidden sm:inline">
              Actualizar
            </span>
          </Button>
        </div>
      </div>

      <div className="mb-4 grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MiniKpi
          icon={DollarSign}
          label="Ventas hoy"
          value={
            loadingToday
              ? "…"
              : money(
                  analysis.todaySales,
                )
          }
          detail={`${analysis.todayTickets} tickets`}
        />

        <MiniKpi
          icon={TrendingUp}
          label="Ventas 7 días"
          value={money(
            analysis.last7Sales,
          )}
          detail={`vs anterior ${weeklyChangeText}`}
        />

        <MiniKpi
          icon={ShoppingCart}
          label="Ventas 30 días"
          value={
            loadingSales30
              ? "…"
              : money(
                  analysis.last30Sales,
                )
          }
          detail={`vs anterior ${salesChangeText}`}
        />

        <MiniKpi
          icon={
            analysis.netProfit >= 0
              ? TrendingUp
              : TrendingDown
          }
          label="Utilidad neta"
          value={money(
            analysis.netProfit,
          )}
          detail={`Margen ${analysis.margin.toFixed(
            1,
          )}%`}
        />

        <MiniKpi
          icon={
            analysis.outOfStock.length > 0
              ? AlertTriangle
              : Boxes
          }
          label="Alertas"
          value={String(
            analysis.alerts.length,
          )}
          detail={`${analysis.outOfStock.length} agotados · ${analysis.lowStock.length} bajo mínimo`}
        />
      </div>

      <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
        {SUGGESTIONS.map(
          (suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() =>
                ask(suggestion)
              }
              className="whitespace-nowrap rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              {suggestion}
            </button>
          ),
        )}
      </div>

      <div className="mb-4 grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Hoy"
          value={money(
            analysis.todaySales,
          )}
          detail={`${analysis.todayTickets} tickets · promedio ${money(
            analysis.todayAverageTicket,
          )}`}
          icon={DollarSign}
        />

        <MetricCard
          title="Ayer"
          value={money(
            analysis.yesterdaySales,
          )}
          detail={`${analysis.yesterdayTickets} tickets · promedio ${money(
            analysis.yesterdayAverageTicket,
          )}`}
          icon={TrendingDown}
        />

        <MetricCard
          title="Semana"
          value={money(
            analysis.last7Sales,
          )}
          detail={`${analysis.tickets7} tickets · ${weeklyChangeText} vs periodo anterior`}
          icon={TrendingUp}
        />

        <MetricCard
          title="Inventario"
          value={`${analysis.inventoryAvailable.toLocaleString(
            "es-MX",
          )} uds`}
          detail={`${money(
            analysis.inventoryRetail,
          )} valor de venta`}
          icon={Boxes}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0 border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4" />
              Inteligencia de negocio

              <Badge
                variant="secondary"
                className="ml-auto"
              >
                Sin API externa
              </Badge>
            </CardTitle>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <ScrollArea className="min-h-0 flex-1 px-4 py-3">
              <div className="space-y-3">
                {messages.map(
                  (
                    message,
                    index,
                  ) => (
                    <div
                      key={index}
                      className={cn(
                        "max-w-[94%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm",
                        message.role ===
                          "user"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "bg-muted",
                      )}
                    >
                      {message.text}
                    </div>
                  ),
                )}

                {thinking && (
                  <div className="max-w-[94%] rounded-2xl bg-muted px-3.5 py-2.5 text-sm">
                    Analizando datos…
                  </div>
                )}
              </div>
            </ScrollArea>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                ask(input);
              }}
              className="flex shrink-0 gap-2 border-t p-3"
            >
              <Input
                value={input}
                onChange={(event) =>
                  setInput(event.target.value)
                }
                placeholder="Pregunta sobre ventas, utilidad, inventario..."
                disabled={thinking}
                aria-label="Pregunta al CEO IA"
              />

              <Button
                type="submit"
                size="icon"
                disabled={
                  !input.trim() ||
                  thinking
                }
                aria-label="Enviar pregunta"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">
              Indicadores rápidos
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3 overflow-y-auto p-4">
            <QuickRow
              label="Utilidad bruta"
              value={money(
                analysis.grossProfit,
              )}
            />

            <QuickRow
              label="Utilidad neta"
              value={money(
                analysis.netProfit,
              )}
            />

            <QuickRow
              label="Margen bruto"
              value={`${analysis.margin.toFixed(
                1,
              )}%`}
            />

            <QuickRow
              label="Ticket promedio"
              value={money(
                analysis.averageTicket,
              )}
            />

            <QuickRow
              label="Unidades por ticket"
              value={analysis.averageUnitsPerSale.toFixed(
                1,
              )}
            />

            <QuickRow
              label="Inventario a costo"
              value={money(
                analysis.inventoryCost,
              )}
            />

            <QuickRow
              label="Inventario a venta"
              value={money(
                analysis.inventoryRetail,
              )}
            />

            <QuickRow
              label="Agotados"
              value={String(
                analysis.outOfStock.length,
              )}
            />

            <QuickRow
              label="Bajo mínimo"
              value={String(
                analysis.lowStock.length,
              )}
            />

            <QuickRow
              label="Sin movimiento"
              value={String(
                analysis.stagnant.length,
              )}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniKpi({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3">
        <div className="rounded-lg bg-muted p-2">
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {label}
          </p>

          <p className="truncate text-lg font-semibold">
            {value}
          </p>

          <p className="truncate text-xs text-muted-foreground">
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof DollarSign;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-xl bg-muted p-2.5">
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {title}
          </p>

          <p className="truncate text-xl font-bold">
            {value}
          </p>

          <p className="truncate text-xs text-muted-foreground">
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <span className="text-sm text-muted-foreground">
        {label}
      </span>

      <span className="text-sm font-semibold">
        {value}
      </span>
    </div>
  );
}