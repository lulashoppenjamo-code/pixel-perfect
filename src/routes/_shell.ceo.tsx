import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Boxes,
  DollarSign,
  Package,
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
import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";

export const Route = createFileRoute("/_shell/ceo")({
  head: () => ({
    meta: [
      { title: "CEO IA — Lula OS" },
      {
        name: "description",
        content:
          "Centro ejecutivo de ventas, utilidad e inventario de Lula OS.",
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

type Sale = {
  id: string;
  total: number;
  created_at: string;
};

type SaleItem = {
  sale_id: string;
  name_snapshot: string;
  quantity: number;
  total: number;
  product_id: string | null;
  variant_id: string | null;
  unit_cost: number | null;
  cost_total: number | null;
};

type Product = {
  id: string;
  name: string;
  cost: number;
  price: number;
};

type Expense = {
  amount: number;
};

const SUGGESTIONS = [
  "¿Cómo están las ventas hoy?",
  "¿Cómo vamos este mes?",
  "¿Cuál es la utilidad real?",
  "¿Qué productos venden más?",
  "¿Qué productos están por agotarse?",
  "¿Qué debo comprar?",
  "¿Cuál es el ticket promedio?",
  "¿Qué productos tienen mayor margen?",
  "¿Qué productos están estancados?",
  "¿Cómo vamos contra el periodo anterior?",
  "Dame un resumen ejecutivo",
  "¿Cómo está mi inventario?",
];

function CeoPage() {
  const { branchId, branches } = useBranch();

  const branchName =
    branches.find((branch) => branch.id === branchId)?.name ??
    "Sucursal";

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        `Hola. Soy el CEO IA de LULA OS.\n\n` +
        `Estoy conectado a las ventas, costos históricos, gastos e inventario compartido.\n\n` +
        `Puedes preguntarme por ventas, utilidad, inventario, productos, compras o tendencias.`,
    },
  ]);

  const now = new Date();

  /*
   * PERIODOS EXACTOS
   *
   * 30 días actuales:
   * hoy + 29 días anteriores.
   *
   * 30 días anteriores:
   * los 30 días inmediatamente anteriores al periodo actual.
   */
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
  } = useQuery({
    queryKey: ["ceo", "sales-today", branchId, todayStart],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,total,created_at")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", todayStart)
        .order("created_at", {
          ascending: true,
        });

      if (error) throw error;

      return (data ?? []) as Sale[];
    },
  });

  const {
    data: sales30 = [],
    isLoading: loadingSales30,
  } = useQuery({
    queryKey: ["ceo", "sales-30", branchId, since30],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,total,created_at")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", since30)
        .order("created_at", {
          ascending: true,
        });

      if (error) throw error;

      return (data ?? []) as Sale[];
    },
  });

  const {
    data: salesPrevious = [],
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
      const { data, error } = await supabase
        .from("sales")
        .select("id,total,created_at")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", since60)
        .lt("created_at", since30)
        .order("created_at", {
          ascending: true,
        });

      if (error) throw error;

      return (data ?? []) as Sale[];
    },
  });

  const {
    data: salesMonth = [],
  } = useQuery({
    queryKey: [
      "ceo",
      "sales-month",
      branchId,
      monthStart,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,total,created_at")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", monthStart)
        .order("created_at", {
          ascending: true,
        });

      if (error) throw error;

      return (data ?? []) as Sale[];
    },
  });

  const saleIds = useMemo(
    () => sales30.map((sale) => sale.id),
    [sales30],
  );

  const {
    data: saleItems = [],
  } = useQuery({
    queryKey: [
      "ceo",
      "sale-items",
      saleIds.join(","),
    ],
    enabled: saleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
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

      if (error) throw error;

      return (data ?? []) as SaleItem[];
    },
  });

  const {
    data: inventory = [],
    isLoading: loadingInventory,
  } = useQuery({
    queryKey: ["ceo", "shared-inventory"],
    queryFn: async () =>
      getSharedInventory(),
  });

  const {
    data: products = [],
  } = useQuery({
    queryKey: ["ceo", "products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,cost,price",
        )
        .eq("is_active", true);

      if (error) throw error;

      return (data ?? []) as Product[];
    },
  });

  const {
    data: expenses = [],
  } = useQuery({
    queryKey: [
      "ceo",
      "expenses",
      branchId,
      monthStart,
    ],
    enabled: !!branchId,
    queryFn: async () => {
      const todayDate =
        new Date()
          .toISOString()
          .slice(0, 10);

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
            monthStart.slice(0, 10),
          )
          .lte(
            "expense_date",
            todayDate,
          );

      if (error) {
        if (
          error.code === "42P01" ||
          error.message?.includes(
            "does not exist",
          )
        ) {
          return [] as Expense[];
        }

        throw error;
      }

      return (data ?? []) as Expense[];
    },
  });

  const analysis = useMemo(() => {
    const sumSales = (
      rows: Sale[],
    ) =>
      rows.reduce(
        (total, sale) =>
          total +
          Number(
            sale.total ?? 0,
          ),
        0,
      );

    const todaySales =
      sumSales(salesToday);

    const last30Sales =
      sumSales(sales30);

    const previousSales =
      sumSales(salesPrevious);

    const monthSales =
      sumSales(salesMonth);

    const change =
      previousSales > 0
        ? ((last30Sales -
            previousSales) /
            previousSales) *
          100
        : last30Sales > 0
          ? 100
          : 0;

    let revenue = 0;
    let historicalCost = 0;

    const productMap = new Map<
      string,
      {
        name: string;
        quantity: number;
        revenue: number;
        cost: number;
      }
    >();

    const soldProductIds =
      new Set<string>();

    for (const item of saleItems) {
      const quantity =
        Number(
          item.quantity ?? 0,
        );

      const revenueValue =
        Number(
          item.total ?? 0,
        );

      revenue +=
        revenueValue;

      const cost =
        item.cost_total !==
          null &&
        item.cost_total !==
          undefined
          ? Number(
              item.cost_total,
            )
          : Number(
              item.unit_cost ??
                0,
            ) * quantity;

      historicalCost +=
        cost;

      if (
        item.product_id
      ) {
        soldProductIds.add(
          item.product_id,
        );
      }

      const key =
        item.product_id ??
        `snapshot:${item.name_snapshot}`;

      const current =
        productMap.get(key) ??
        {
          name:
            item.name_snapshot,
          quantity: 0,
          revenue: 0,
          cost: 0,
        };

      current.quantity +=
        quantity;

      current.revenue +=
        revenueValue;

      current.cost +=
        cost;

      productMap.set(
        key,
        current,
      );
    }

    const grossProfit =
      revenue -
      historicalCost;

    const margin =
      revenue > 0
        ? (grossProfit /
            revenue) *
          100
        : 0;

    const expensesTotal =
      expenses.reduce(
        (total, expense) =>
          total +
          Number(
            expense.amount ?? 0,
          ),
        0,
      );

    const netProfit =
      grossProfit -
      expensesTotal;

    const shared =
      inventory as SharedInventoryRow[];

    const lowStock = [
      ...shared,
    ]
      .filter(
        (item) =>
          Number(
            item.available_stock ??
              0,
          ) <=
          Number(
            item.min_stock ??
              0,
          ),
      )
      .sort(
        (a, b) =>
          Number(
            a.available_stock ??
              0,
          ) -
          Number(
            b.available_stock ??
              0,
          ),
      );

    const outOfStock =
      shared.filter(
        (item) =>
          Number(
            item.available_stock ??
              0,
          ) <= 0,
      );

    const stagnant = shared
      .filter(
        (item) =>
          Number(
            item.available_stock ??
              0,
          ) > 0 &&
          !!item.product_id &&
          !soldProductIds.has(
            item.product_id,
          ),
      )
      .slice(0, 20);

    const topProducts =
      Array.from(
        productMap.values(),
      )
        .map((product) => {
          const profit =
            product.revenue -
            product.cost;

          return {
            ...product,
            profit,
            margin:
              product.revenue >
              0
                ? (profit /
                    product.revenue) *
                  100
                : 0,
          };
        })
        .sort(
          (a, b) =>
            b.revenue -
            a.revenue,
        )
        .slice(0, 15);

    const catalogMargins =
      products
        .map((product) => {
          const price =
            Number(
              product.price ??
                0,
            );

          const cost =
            Number(
              product.cost ??
                0,
            );

          return {
            name:
              product.name,
            price,
            cost,
            margin:
              price > 0
                ? ((price -
                    cost) /
                    price) *
                  100
                : 0,
          };
        })
        .filter(
          (product) =>
            product.price > 0,
        )
        .sort(
          (a, b) =>
            b.margin -
            a.margin,
        );

    const inventoryUnits =
      shared.reduce(
        (total, item) =>
          total +
          Number(
            item.stock ?? 0,
          ),
        0,
      );

    const inventoryAvailable =
      shared.reduce(
        (total, item) =>
          total +
          Number(
            item.available_stock ??
              0,
          ),
        0,
      );

    const inventoryReserved =
      shared.reduce(
        (total, item) =>
          total +
          Number(
            item.reserved_stock ??
              0,
          ),
        0,
      );

    const inventoryCost =
      shared.reduce(
        (total, item) =>
          total +
          Number(
            item.stock ?? 0,
          ) *
            Number(
              item.cost ?? 0,
            ),
        0,
      );

    const inventoryRetail =
      shared.reduce(
        (total, item) =>
          total +
          Number(
            item.stock ?? 0,
          ) *
            Number(
              item.price ?? 0,
            ),
        0,
      );

    const inventoryCoverage =
      last30Sales > 0
        ? inventoryRetail /
          last30Sales
        : 0;

    return {
      todaySales,
      last30Sales,
      previousSales,
      monthSales,

      todayTickets:
        salesToday.length,

      tickets30:
        sales30.length,

      previousTickets:
        salesPrevious.length,

      monthTickets:
        salesMonth.length,

      averageTicket:
        sales30.length > 0
          ? last30Sales /
            sales30.length
          : 0,

      todayAverageTicket:
        salesToday.length > 0
          ? todaySales /
            salesToday.length
          : 0,

      change,

      revenue,
      historicalCost,
      grossProfit,
      margin,
      expensesTotal,
      netProfit,

      lowStock,
      outOfStock,
      stagnant,

      topProducts,
      catalogMargins,

      inventoryUnits,
      inventoryAvailable,
      inventoryReserved,
      inventoryCost,
      inventoryRetail,
      inventoryCoverage,
    };
  }, [
    salesToday,
    sales30,
    salesPrevious,
    salesMonth,
    saleItems,
    inventory,
    products,
    expenses,
  ]);

  const answer = (
    question: string,
  ) => {
    const text =
      question
        .toLowerCase()
        .normalize("NFD")
        .replace(
          /\p{Diacritic}/gu,
          "",
        );

    if (
      text.includes("hoy") &&
      (
        text.includes(
          "venta",
        ) ||
        text.includes(
          "vend",
        ) ||
        text.includes(
          "como",
        )
      )
    ) {
      return (
        `VENTAS DE HOY — ${branchName}\n\n` +
        `Tickets: ${analysis.todayTickets}\n` +
        `Ingresos: ${money(
          analysis.todaySales,
        )}\n` +
        `Ticket promedio: ${money(
          analysis.todayAverageTicket,
        )}`
      );
    }

    if (
      text.includes("mes") &&
      !text.includes(
        "anterior",
      )
    ) {
      return (
        `VENTAS DEL MES\n\n` +
        `Ingresos: ${money(
          analysis.monthSales,
        )}\n` +
        `Tickets: ${analysis.monthTickets}\n` +
        `Ticket promedio: ${money(
          analysis.monthTickets >
            0
            ? analysis.monthSales /
                analysis.monthTickets
            : 0,
        )}`
      );
    }

    if (
      text.includes(
        "resumen",
      ) ||
      text.includes(
        "como vamos",
      ) ||
      text.includes(
        "como van",
      )
    ) {
      return (
        `RESUMEN EJECUTIVO — ${branchName}\n\n` +
        `Ventas 30 días: ${money(
          analysis.last30Sales,
        )}\n` +
        `Tickets: ${analysis.tickets30}\n` +
        `Ticket promedio: ${money(
          analysis.averageTicket,
        )}\n` +
        `Variación: ${
          analysis.change >= 0
            ? "+"
            : ""
        }${analysis.change.toFixed(
          1,
        )}%\n\n` +
        `Utilidad bruta: ${money(
          analysis.grossProfit,
        )}\n` +
        `Margen: ${analysis.margin.toFixed(
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
        `Bajo mínimo: ${analysis.lowStock.length}\n` +
        `Agotados: ${analysis.outOfStock.length}`
      );
    }

    if (
      text.includes(
        "ticket",
      )
    ) {
      return (
        `TICKET PROMEDIO\n\n` +
        `Últimos 30 días: ${money(
          analysis.averageTicket,
        )}\n` +
        `Hoy: ${money(
          analysis.todayAverageTicket,
        )}\n` +
        `Tickets analizados: ${analysis.tickets30}`
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
        "que se vende",
      )
    ) {
      if (
        !analysis.topProducts
          .length
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
      text.includes(
        "agot",
      ) ||
      text.includes(
        "stock",
      ) ||
      text.includes(
        "minimo",
      ) ||
      text.includes(
        "inventario",
      )
    ) {
      if (
        text.includes(
          "inventario",
        ) &&
        !text.includes(
          "agot",
        )
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
          `Cobertura sobre ventas 30 días: ${analysis.inventoryCoverage.toFixed(
            1,
          )}x\n` +
          `Bajo mínimo: ${analysis.lowStock.length}\n` +
          `Agotados: ${analysis.outOfStock.length}`
        );
      }

      const rows =
        analysis.lowStock.slice(
          0,
          15,
        );

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
      text.includes(
        "comprar",
      ) ||
      text.includes(
        "reponer",
      ) ||
      text.includes(
        "pedir",
      ) ||
      text.includes(
        "pedido",
      )
    ) {
      if (
        !analysis.lowStock
          .length
      ) {
        return "No hay alertas de reposición basadas en los mínimos configurados.";
      }

      return (
        `SUGERENCIA DE REPOSICIÓN\n\n` +
        analysis.lowStock
          .slice(0, 15)
          .map((item) => {
            const available =
              Number(
                item.available_stock ??
                  0,
              );

            const minimum =
              Number(
                item.min_stock ??
                  0,
              );

            const maximum =
              item.max_stock !==
                null &&
              item.max_stock !==
                undefined
                ? Number(
                    item.max_stock,
                  )
                : null;

            let suggested =
              Math.max(
                minimum -
                  available,
                1,
              );

            if (
              maximum !==
                null &&
              maximum >
                available
            ) {
              suggested =
                Math.max(
                  maximum -
                    available,
                  suggested,
                );
            }

            return (
              `• ${item.product_name}: ` +
              `stock ${available}, ` +
              `mínimo ${minimum}, ` +
              `${
                maximum !==
                null
                  ? `máximo ${maximum}, `
                  : ""
              }` +
              `sugerido ${suggested} uds`
            );
          })
          .join("\n")
      );
    }

    if (
      text.includes(
        "utilidad",
      ) ||
      text.includes(
        "ganancia",
      ) ||
      text.includes(
        "margen",
      )
    ) {
      if (
        text.includes(
          "mayor margen",
        ) ||
        text.includes(
          "mejor margen",
        )
      ) {
        if (
          !analysis
            .catalogMargins
            .length
        ) {
          return "No hay productos con precio válido para calcular margen.";
        }

        return (
          `MAYORES MÁRGENES DEL CATÁLOGO\n\n` +
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
      text.includes(
        "anterior",
      ) ||
      text.includes(
        "compar",
      ) ||
      text.includes(
        "periodo",
      ) ||
      text.includes(
        "vs",
      )
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
      text.includes(
        "estanc",
      ) ||
      text.includes(
        "no se vende",
      ) ||
      text.includes(
        "parado",
      )
    ) {
      if (
        !analysis.stagnant
          .length
      ) {
        return "No detecté productos con existencia disponible que no hayan aparecido en las ventas de los últimos 30 días.";
      }

      return (
        `PRODUCTOS SIN MOVIMIENTO — 30 DÍAS\n\n` +
        analysis.stagnant
          .map(
            (item) =>
              `• ${item.product_name} — disponible ${item.available_stock}`,
          )
          .join("\n")
      );
    }

    return (
      `Puedo analizar:\n\n` +
      `• Ventas de hoy y del mes\n` +
      `• Ventas exactas de los últimos 30 días\n` +
      `• Comparación contra los 30 días anteriores\n` +
      `• Ticket promedio\n` +
      `• Utilidad bruta y neta\n` +
      `• Gastos\n` +
      `• Márgenes\n` +
      `• Productos más vendidos\n` +
      `• Productos bajo mínimo\n` +
      `• Qué comprar o reponer\n` +
      `• Inventario central\n` +
      `• Productos sin movimiento`
    );
  };

  const ask = (
    question: string,
  ) => {
    const value =
      question.trim();

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

    window.setTimeout(
      () => {
        setMessages(
          (current) => [
            ...current,
            {
              role: "assistant",
              text: answer(
                value,
              ),
            },
          ],
        );

        setThinking(false);
      },
      200,
    );
  };

  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-0 flex-col p-3 sm:p-4 md:h-[calc(100vh-1rem)] md:p-6">
      <PageHeader
        icon={Bot}
        title="CEO IA"
        description={`Centro de inteligencia de LULA OS — ${branchName}`}
        className="mb-4 shrink-0"
      />

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
        />

        <MiniKpi
          icon={TrendingUp}
          label="Ventas 30 días"
          value={
            loadingSales30
              ? "…"
              : money(
                  analysis.last30Sales,
                )
          }
        />

        <MiniKpi
          icon={ShoppingCart}
          label="Ticket promedio"
          value={
            loadingSales30
              ? "…"
              : money(
                  analysis.averageTicket,
                )
          }
        />

        <MiniKpi
          icon={
            analysis.netProfit >=
            0
              ? TrendingUp
              : TrendingDown
          }
          label="Utilidad neta"
          value={money(
            analysis.netProfit,
          )}
        />

        <MiniKpi
          icon={
            analysis.lowStock
              .length > 0
              ? AlertTriangle
              : Boxes
          }
          label="Alertas"
          value={String(
            analysis.lowStock
              .length,
          )}
        />
      </div>

      <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
        {SUGGESTIONS.map(
          (suggestion) => (
            <button
              key={
                suggestion
              }
              type="button"
              onClick={() =>
                ask(
                  suggestion,
                )
              }
              className="whitespace-nowrap rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              {suggestion}
            </button>
          ),
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0 border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4" />
              Inteligencia de negocio

              <Badge
                variant="secondary"
                className="ml-auto"
              >
                Datos reales
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
                      key={
                        index
                      }
                      className={cn(
                        "max-w-[94%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm",
                        message.role ===
                          "user"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "bg-muted",
                      )}
                    >
                      {
                        message.text
                      }
                    </div>
                  ),
                )}

                {thinking && (
                  <div className="w-fit rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                    Analizando datos…
                  </div>
                )}
              </div>
            </ScrollArea>

            <form
              className="flex shrink-0 gap-2 border-t p-3"
              onSubmit={(
                event,
              ) => {
                event.preventDefault();
                ask(input);
              }}
            >
              <Input
                value={
                  input
                }
                onChange={(
                  event,
                ) =>
                  setInput(
                    event.target
                      .value,
                  )
                }
                placeholder="Pregúntame sobre tu negocio…"
                className="min-w-0 flex-1"
              />

              <Button
                type="submit"
                size="icon"
                disabled={
                  thinking ||
                  !input.trim()
                }
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="hidden min-h-0 space-y-4 overflow-auto lg:block">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Resumen financiero
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
              <SummaryRow
                label="Ventas 30 días"
                value={money(
                  analysis.last30Sales,
                )}
              />

              <SummaryRow
                label="Periodo anterior"
                value={money(
                  analysis.previousSales,
                )}
              />

              <SummaryRow
                label="Costo mercancía"
                value={money(
                  analysis.historicalCost,
                )}
              />

              <SummaryRow
                label="Utilidad bruta"
                value={money(
                  analysis.grossProfit,
                )}
              />

              <SummaryRow
                label="Margen bruto"
                value={`${analysis.margin.toFixed(
                  1,
                )}%`}
              />

              <SummaryRow
                label="Gastos"
                value={money(
                  analysis.expensesTotal,
                )}
              />

              <div className="border-t pt-3">
                <SummaryRow
                  label="Utilidad neta"
                  value={money(
                    analysis.netProfit,
                  )}
                  strong
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Inventario central
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
              <SummaryRow
                label="Existencia"
                value={`${analysis.inventoryUnits.toLocaleString(
                  "es-MX",
                )} uds`}
              />

              <SummaryRow
                label="Disponible"
                value={`${analysis.inventoryAvailable.toLocaleString(
                  "es-MX",
                )} uds`}
              />

              <SummaryRow
                label="Reservado"
                value={`${analysis.inventoryReserved.toLocaleString(
                  "es-MX",
                )} uds`}
              />

              <SummaryRow
                label="Valor a costo"
                value={money(
                  analysis.inventoryCost,
                )}
              />

              <SummaryRow
                label="Valor de venta"
                value={money(
                  analysis.inventoryRetail,
                )}
              />

              <SummaryRow
                label="Cobertura"
                value={`${analysis.inventoryCoverage.toFixed(
                  1,
                )}x`}
              />

              <SummaryRow
                label="Agotados"
                value={String(
                  analysis.outOfStock
                    .length,
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4" />
                Sin movimiento
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-2">
              {analysis.stagnant
                .length ===
              0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay productos detectados.
                </p>
              ) : (
                analysis.stagnant
                  .slice(0, 8)
                  .map(
                    (
                      item,
                    ) => (
                      <div
                        key={`${item.product_id}-${item.variant_id ?? "base"}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">
                          {
                            item.product_name
                          }
                        </span>

                        <Badge variant="outline">
                          {
                            item.available_stock
                          }
                        </Badge>
                      </div>
                    ),
                  )
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4" />
                Alertas
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
              <SummaryRow
                label="Bajo mínimo"
                value={String(
                  analysis.lowStock
                    .length,
                )}
              />

              <SummaryRow
                label="Agotados"
                value={String(
                  analysis.outOfStock
                    .length,
                )}
              />

              <SummaryRow
                label="Sin movimiento"
                value={String(
                  analysis.stagnant
                    .length,
                )}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        strong &&
          "font-semibold",
      )}
    >
      <span>{label}</span>
      <span className="text-right">
        {value}
      </span>
    </div>
  );
}

function MiniKpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3.5">
        <div className="shrink-0 rounded-lg bg-primary/10 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>

        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {label}
          </p>

          <p className="truncate text-lg font-bold">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}