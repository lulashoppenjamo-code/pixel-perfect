import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Send,
  Sparkles,
  TrendingUp,
  Package,
  ShoppingCart,
  AlertTriangle,
  DollarSign,
  Boxes,
} from "lucide-react";
import {
  subDays,
  startOfDay,
} from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/ceo")({
  head: () => ({
    meta: [
      {
        title: "CEO IA — Lula OS",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="ceo">
      <CeoPage />
    </RequireNavAccess>
  ),
});

type Msg = {
  role: "user" | "assistant";
  text: string;
};

type SaleRow = {
  id: string;
  total: number;
  created_at: string;
};

type SaleItemRow = {
  sale_id: string;
  name_snapshot: string;
  quantity: number;
  total: number;
  product_id: string | null;
  variant_id: string | null;
  unit_cost: number | null;
  cost_total: number | null;
};

type ProductRow = {
  id: string;
  name: string;
  cost: number;
  price: number;
};

const SUGGESTIONS = [
  "¿Cómo están las ventas hoy?",
  "¿Cómo vamos este mes?",
  "¿Qué productos se están vendiendo más?",
  "¿Qué productos están por agotarse?",
  "¿Qué debo comprar?",
  "¿Cuál es el ticket promedio?",
  "¿Cuál es la utilidad real?",
  "¿Qué productos tienen mayor margen?",
  "¿Qué productos están estancados?",
  "¿Cómo vamos contra el periodo anterior?",
];

function CeoPage() {
  const { branchId, branches } =
    useBranch();

  const branchName =
    branches.find(
      (branch) =>
        branch.id === branchId,
    )?.name ??
    "Sucursal";

  const [
    input,
    setInput,
  ] = useState("");

  const [
    messages,
    setMessages,
  ] = useState<Msg[]>([
    {
      role: "assistant",
      text:
        `Hola. Soy el CEO IA de LULA OS.\n\n` +
        `Estoy conectado a las ventas, costos históricos e inventario compartido de ${branchName}.\n\n` +
        `Puedes preguntarme qué vender, qué comprar, qué está bajo de stock, cuánto estás ganando o cómo va el negocio.`,
    },
  ]);

  const [
    thinking,
    setThinking,
  ] = useState(false);

  const since30 =
    startOfDay(
      subDays(
        new Date(),
        30,
      ),
    ).toISOString();

  const since60 =
    startOfDay(
      subDays(
        new Date(),
        60,
      ),
    ).toISOString();

  const todayStart =
    startOfDay(
      new Date(),
    ).toISOString();

  /*
   * ============================================================
   * VENTAS 30 DÍAS
   * ============================================================
   */

  const {
    data: sales30 = [],
  } = useQuery({
    queryKey: [
      "ceo-sales-30",
      branchId,
    ],

    enabled:
      !!branchId,

    queryFn:
      async () => {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "sales",
            )
            .select(
              "id, total, created_at",
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
            );

        if (error) {
          throw error;
        }

        return (
          data ??
          []
        ) as SaleRow[];
      },
  });

  /*
   * ============================================================
   * VENTAS HOY
   * ============================================================
   */

  const {
    data: salesToday = [],
  } = useQuery({
    queryKey: [
      "ceo-sales-today",
      branchId,
    ],

    enabled:
      !!branchId,

    queryFn:
      async () => {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "sales",
            )
            .select(
              "id, total, created_at",
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
            );

        if (error) {
          throw error;
        }

        return (
          data ??
          []
        ) as SaleRow[];
      },
  });

  /*
   * ============================================================
   * PERIODO ANTERIOR
   * ============================================================
   */

  const {
    data: salesPrevious = [],
  } = useQuery({
    queryKey: [
      "ceo-sales-previous",
      branchId,
    ],

    enabled:
      !!branchId,

    queryFn:
      async () => {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "sales",
            )
            .select(
              "id, total, created_at",
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
            );

        if (error) {
          throw error;
        }

        return (
          data ??
          []
        ) as SaleRow[];
      },
  });

  /*
   * ============================================================
   * ITEMS DE VENTA
   * ============================================================
   */

  const saleIds =
    sales30.map(
      (sale) =>
        sale.id,
    );

  const {
    data: items = [],
  } = useQuery({
    queryKey: [
      "ceo-sale-items",
      saleIds.join(","),
    ],

    enabled:
      saleIds.length >
      0,

    queryFn:
      async () => {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "sale_items",
            )
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

        return (
          data ??
          []
        ) as SaleItemRow[];
      },
  });

  /*
   * ============================================================
   * INVENTARIO CENTRAL
   * ============================================================
   */

  const {
    data: inventory = [],
  } =
    useQuery({
      queryKey: [
        "ceo-shared-inventory",
      ],

      queryFn:
        async () => {
          return await getSharedInventory();
        },
    });

  /*
   * ============================================================
   * CATÁLOGO
   * ============================================================
   */

  const {
    data: products = [],
  } =
    useQuery({
      queryKey: [
        "ceo-products",
      ],

      queryFn:
        async () => {
          const {
            data,
            error,
          } =
            await supabase
              .from(
                "products",
              )
              .select(
                "id, name, cost, price",
              )
              .eq(
                "is_active",
                true,
              );

          if (error) {
            throw error;
          }

          return (
            data ??
            []
          ) as ProductRow[];
        },
    });

  /*
   * ============================================================
   * MOTOR DE ANÁLISIS
   * ============================================================
   */

  const buildAnalysis =
    () => {
      const totalToday =
        salesToday.reduce(
          (
            total,
            sale,
          ) =>
            total +
            Number(
              sale.total ??
                0,
            ),
          0,
        );

      const total30 =
        sales30.reduce(
          (
            total,
            sale,
          ) =>
            total +
            Number(
              sale.total ??
                0,
            ),
          0,
        );

      const totalPrevious =
        salesPrevious.reduce(
          (
            total,
            sale,
          ) =>
            total +
            Number(
              sale.total ??
                0,
            ),
          0,
        );

      const tickets30 =
        sales30.length;

      const averageTicket =
        tickets30 >
        0
          ? total30 /
            tickets30
          : 0;

      const change =
        totalPrevious >
        0
          ? ((total30 -
              totalPrevious) /
              totalPrevious) *
            100
          : total30 > 0
            ? 100
            : 0;

      /*
       * --------------------------------------------------------
       * UTILIDAD HISTÓRICA
       * --------------------------------------------------------
       */

      let revenue =
        0;

      let historicalCost =
        0;

      for (const item of items) {
        revenue +=
          Number(
            item.total ??
              0,
          );

        if (
          item.cost_total !==
            null &&
          item.cost_total !==
            undefined
        ) {
          historicalCost +=
            Number(
              item.cost_total,
            );
        } else {
          historicalCost +=
            Number(
              item.unit_cost ??
                0,
            ) *
            Number(
              item.quantity ??
                0,
            );
        }
      }

      const grossProfit =
        revenue -
        historicalCost;

      const marginPercent =
        revenue >
        0
          ? (grossProfit /
              revenue) *
            100
          : 0;

      /*
       * --------------------------------------------------------
       * PRODUCTOS MÁS VENDIDOS
       * --------------------------------------------------------
       */

      const topMap =
        new Map<
          string,
          {
            name: string;
            quantity: number;
            revenue: number;
            cost: number;
          }
        >();

      for (const item of items) {
        const key =
          item.product_id ??
          `name:${item.name_snapshot}`;

        const current =
          topMap.get(
            key,
          ) ?? {
            name:
              item.name_snapshot,
            quantity: 0,
            revenue: 0,
            cost: 0,
          };

        current.quantity +=
          Number(
            item.quantity ??
              0,
          );

        current.revenue +=
          Number(
            item.total ??
              0,
          );

        current.cost +=
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
              ) *
              Number(
                item.quantity ??
                  0,
              );

        topMap.set(
          key,
          current,
        );
      }

      const topProducts =
        Array.from(
          topMap.values(),
        )
          .map(
            (
              product,
            ) => ({
              ...product,
              profit:
                product.revenue -
                product.cost,
            }),
          )
          .sort(
            (
              a,
              b,
            ) =>
              b.quantity -
              a.quantity,
          );

      /*
       * --------------------------------------------------------
       * STOCK BAJO
       * --------------------------------------------------------
       */

      const shared =
        inventory as SharedInventoryRow[];

      const lowStock =
        shared
          .filter(
            (item) =>
              Number(
                item.available_stock,
              ) <=
              Number(
                item.min_stock,
              ),
          )
          .sort(
            (
              a,
              b,
            ) =>
              Number(
                a.available_stock,
              ) -
              Number(
                b.available_stock,
              ),
          );

      /*
       * --------------------------------------------------------
       * AGOTADOS
       * --------------------------------------------------------
       */

      const outOfStock =
        shared.filter(
          (item) =>
            Number(
              item.available_stock,
            ) <= 0,
        );

      /*
       * --------------------------------------------------------
       * PRODUCTOS ESTANCADOS
       * --------------------------------------------------------
       */

      const soldProductIds =
        new Set(
          items
            .map(
              (item) =>
                item.product_id,
            )
            .filter(
              Boolean,
            ),
        );

      const stagnant =
        shared
          .filter(
            (item) =>
              Number(
                item.available_stock,
              ) > 0 &&
              item.product_id &&
              !soldProductIds.has(
                item.product_id,
              ),
          )
          .slice(
            0,
            15,
          );

      /*
       * --------------------------------------------------------
       * MÁRGENES DE CATÁLOGO
       * --------------------------------------------------------
       */

      const marginProducts =
        products
          .map(
            (
              product,
            ) => {
              const price =
                Number(
                  product.price,
                );

              const cost =
                Number(
                  product.cost,
                );

              const margin =
                price > 0
                  ? ((price -
                      cost) /
                      price) *
                    100
                  : 0;

              return {
                name:
                  product.name,
                price,
                cost,
                margin,
              };
            },
          )
          .filter(
            (product) =>
              product.price >
              0,
          )
          .sort(
            (
              a,
              b,
            ) =>
              b.margin -
              a.margin,
          );

      return {
        totalToday,
        total30,
        totalPrevious,
        tickets30,
        averageTicket,
        change,
        revenue,
        historicalCost,
        grossProfit,
        marginPercent,
        topProducts,
        lowStock,
        outOfStock,
        stagnant,
        marginProducts,
        inventoryUnits:
          shared.reduce(
            (
              total,
              item,
            ) =>
              total +
              Number(
                item.stock ??
                  0,
              ),
            0,
          ),
        inventoryAvailable:
          shared.reduce(
            (
              total,
              item,
            ) =>
              total +
              Number(
                item.available_stock ??
                  0,
              ),
            0,
          ),
        inventoryReserved:
          shared.reduce(
            (
              total,
              item,
            ) =>
              total +
              Number(
                item.reserved_stock ??
                  0,
              ),
            0,
          ),
      };
    };

  /*
   * ============================================================
   * RESPUESTAS
   * ============================================================
   */

  const answer =
    (
      question: string,
    ): string => {
      const text =
        question
          .toLowerCase()
          .normalize(
            "NFD",
          )
          .replace(
            /\p{Diacritic}/gu,
            "",
          );

      const analysis =
        buildAnalysis();

      /*
       * HOY
       */

      if (
        text.includes(
          "hoy",
        ) &&
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
          `• Ventas: ${salesToday.length}\n` +
          `• Ingresos: ${money(analysis.totalToday)}\n` +
          `• Ticket promedio: ${money(
            salesToday.length
              ? analysis.totalToday /
                  salesToday.length
              : 0,
          )}`
        );
      }

      /*
       * RESUMEN
       */

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
            analysis.total30,
          )}\n` +
          `Tickets: ${analysis.tickets30}\n` +
          `Ticket promedio: ${money(
            analysis.averageTicket,
          )}\n` +
          `Ventas hoy: ${money(
            analysis.totalToday,
          )}\n` +
          `Variación vs periodo anterior: ${
            analysis.change >=
            0
              ? "+"
              : ""
          }${analysis.change.toFixed(
            1,
          )}%\n\n` +
          `Utilidad bruta: ${money(
            analysis.grossProfit,
          )}\n` +
          `Margen bruto: ${analysis.marginPercent.toFixed(
            1,
          )}%\n\n` +
          `Inventario: ${analysis.inventoryUnits} unidades\n` +
          `Disponibles: ${analysis.inventoryAvailable}\n` +
          `Reservadas: ${analysis.inventoryReserved}\n` +
          `Bajo mínimo: ${analysis.lowStock.length}\n` +
          `Agotados: ${analysis.outOfStock.length}`
        );
      }

      /*
       * TICKET
       */

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
          `Tickets analizados: ${analysis.tickets30}`
        );
      }

      /*
       * PRODUCTOS MÁS VENDIDOS
       */

      if (
        text.includes(
          "mas vendidos",
        ) ||
        text.includes(
          "vendiendo mas",
        ) ||
        text.includes(
          "que se vende",
        ) ||
        text.includes(
          "top",
        )
      ) {
        if (
          !analysis.topProducts
            .length
        ) {
          return "No hay ventas suficientes en los últimos 30 días para analizar productos.";
        }

        const lines =
          analysis.topProducts
            .slice(
              0,
              10,
            )
            .map(
              (
                product,
                index,
              ) =>
                `${index + 1}. ${product.name} — ${product.quantity} uds — ${money(
                  product.revenue,
                )}`,
            )
            .join(
              "\n",
            );

        return (
          `PRODUCTOS MÁS VENDIDOS — 30 DÍAS\n\n` +
          lines
        );
      }

      /*
       * STOCK
       */

      if (
        text.includes(
          "agot",
        ) ||
        text.includes(
          "stock bajo",
        ) ||
        text.includes(
          "bajo minimo",
        ) ||
        text.includes(
          "por agotar",
        )
      ) {
        if (
          !analysis.lowStock
            .length
        ) {
          return "No hay productos bajo el mínimo configurado.";
        }

        const lines =
          analysis.lowStock
            .slice(
              0,
              15,
            )
            .map(
              (
                product,
              ) =>
                `• ${product.product_name}: disponible ${product.available_stock} / mínimo ${product.min_stock}`,
            )
            .join(
              "\n",
            );

        return (
          `ALERTAS DE INVENTARIO\n\n` +
          `Agotados: ${analysis.outOfStock.length}\n` +
          `Bajo mínimo: ${analysis.lowStock.length}\n\n` +
          lines
        );
      }

      /*
       * QUÉ COMPRAR
       */

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
          "pedir",
        )
      ) {
        if (
          !analysis.lowStock
            .length
        ) {
          return "No hay alertas de reposición basadas en los mínimos configurados.";
        }

        const lines =
          analysis.lowStock
            .slice(
              0,
              12,
            )
            .map(
              (
                product,
              ) => {
                const missing =
                  Math.max(
                    Number(
                      product.min_stock,
                    ) -
                      Number(
                        product.available_stock,
                      ),
                    1,
                  );

                return (
                  `• ${product.product_name}: ` +
                  `stock ${product.available_stock}, ` +
                  `mínimo ${product.min_stock}, ` +
                  `sugerido ≥ ${missing} uds`
                );
              },
            )
            .join(
              "\n",
            );

        return (
          `LISTA DE REPOSICIÓN\n\n` +
          lines
        );
      }

      /*
       * UTILIDAD
       */

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
          const lines =
            analysis.marginProducts
              .slice(
                0,
                10,
              )
              .map(
                (
                  product,
                  index,
                ) =>
                  `${index + 1}. ${product.name} — ${product.margin.toFixed(
                    1,
                  )}%`,
              )
              .join(
                "\n",
              );

          return (
            `MAYORES MÁRGENES DEL CATÁLOGO\n\n` +
            lines
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
          `Margen bruto: ${analysis.marginPercent.toFixed(
            1,
          )}%\n\n` +
          `El costo se toma de cost_total/unit_cost guardado en cada venta, por lo que no depende del costo actual del catálogo.`
        );
      }

      /*
       * COMPARACIÓN
       */

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
          `COMPARACIÓN\n\n` +
          `Periodo actual: ${money(
            analysis.total30,
          )}\n` +
          `Periodo anterior: ${money(
            analysis.totalPrevious,
          )}\n` +
          `Variación: ${
            analysis.change >=
            0
              ? "+"
              : ""
          }${analysis.change.toFixed(
            1,
          )}%`
        );
      }

      /*
       * ESTANCADOS
       */

      if (
        text.includes(
          "estanc",
        ) ||
        text.includes(
          "no se vende",
        ) ||
        text.includes(
          "parados",
        )
      ) {
        if (
          !analysis.stagnant
            .length
        ) {
          return "No detecté productos con existencia disponible que no hayan aparecido en las ventas del periodo analizado.";
        }

        return (
          `PRODUCTOS ESTANCADOS\n\n` +
          analysis.stagnant
            .map(
              (
                product,
              ) =>
                `• ${product.product_name} — disponible ${product.available_stock}`,
            )
            .join(
              "\n",
            )
        );
      }

      /*
       * INVENTARIO
       */

      if (
        text.includes(
          "inventario",
        ) ||
        text.includes(
          "existencia",
        ) ||
        text.includes(
          "cuanto tengo",
        )
      ) {
        return (
          `INVENTARIO CENTRAL\n\n` +
          `Existencia total: ${analysis.inventoryUnits} unidades\n` +
          `Disponible para venta: ${analysis.inventoryAvailable}\n` +
          `Reservado: ${analysis.inventoryReserved}\n` +
          `Bajo mínimo: ${analysis.lowStock.length}\n` +
          `Agotados: ${analysis.outOfStock.length}\n\n` +
          `Las dos sucursales utilizan el mismo inventario central.`
        );
      }

      /*
       * SUCURSAL
       */

      if (
        text.includes(
          "sucursal",
        )
      ) {
        return (
          `Actualmente estás consultando: ${branchName}.\n\n` +
          `Las ventas conservan su sucursal de origen, pero la existencia de mercancía se administra mediante el inventario central compartido.`
        );
      }

      /*
       * AYUDA
       */

      return (
        `Puedo analizar:\n\n` +
        `• Ventas de hoy\n` +
        `• Ventas de 30 días\n` +
        `• Ticket promedio\n` +
        `• Productos más vendidos\n` +
        `• Productos bajo mínimo\n` +
        `• Qué comprar o reponer\n` +
        `• Utilidad real con costo histórico\n` +
        `• Márgenes\n` +
        `• Comparación contra el periodo anterior\n` +
        `• Productos estancados\n` +
        `• Inventario disponible\n\n` +
        `Ejemplo: "¿Qué debería comprar esta semana?"`
      );
    };

  /*
   * ============================================================
   * CHAT
   * ============================================================
   */

  const ask =
    (
      question: string,
    ) => {
      const q =
        question.trim();

      if (!q) {
        return;
      }

      setMessages(
        (
          current,
        ) => [
          ...current,
          {
            role: "user",
            text: q,
          },
        ],
      );

      setInput("");
      setThinking(true);

      setTimeout(
        () => {
          const reply =
            answer(q);

          setMessages(
            (
              current,
            ) => [
              ...current,
              {
                role: "assistant",
                text: reply,
              },
            ],
          );

          setThinking(
            false,
          );
        },
        250,
      );
    };

  const analysis =
    buildAnalysis();

  return (
    <div className="flex h-[calc(100dvh-5rem)] flex-col p-4 md:h-[calc(100vh-1rem)] md:p-6">
      <PageHeader
        icon={Bot}
        title="CEO IA"
        description={`Centro de inteligencia de LULA OS — ${branchName}`}
        className="mb-4"
      />

      {/* ======================================================
          RESUMEN RÁPIDO
      ======================================================= */}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniKpi
          icon={DollarSign}
          label="Ventas 30 días"
          value={money(
            analysis.total30,
          )}
        />

        <MiniKpi
          icon={TrendingUp}
          label="Utilidad bruta"
          value={money(
            analysis.grossProfit,
          )}
        />

        <MiniKpi
          icon={ShoppingCart}
          label="Ticket promedio"
          value={money(
            analysis.averageTicket,
          )}
        />

        <MiniKpi
          icon={
            analysis.lowStock
              .length >
            0
              ? AlertTriangle
              : Boxes
          }
          label="Alertas stock"
          value={`${analysis.lowStock.length}`}
        />
      </div>

      {/* ======================================================
          SUGERENCIAS
      ======================================================= */}

      <div className="mb-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map(
          (
            suggestion,
          ) => (
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
              className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              {
                suggestion
              }
            </button>
          ),
        )}
      </div>

      {/* ======================================================
          CHAT
      ======================================================= */}

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="shrink-0 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
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
          <ScrollArea className="flex-1 px-4 py-3">
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
                      "max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm",
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
                  Analizando ventas,
                  costos e
                  inventario…
                </div>
              )}
            </div>
          </ScrollArea>

          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(
              event,
            ) => {
              event.preventDefault();
              ask(input);
            }}
          >
            <Input
              value={input}
              onChange={(
                event,
              ) =>
                setInput(
                  event.target
                    .value,
                )
              }
              placeholder="Pregúntame cualquier cosa sobre el negocio…"
              className="flex-1"
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
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-primary/10 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
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