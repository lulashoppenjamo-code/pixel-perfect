// ============================================================
// src/lib/ceoAnalysis.ts
// LULA OS — MOTOR DE INTELIGENCIA CEO
// F5 BLOQUE 1
//
// Motor local y determinístico.
// NO usa API externa ni genera costos de IA.
//
// Objetivo:
// - Ventas
// - Utilidad
// - Margen
// - Gastos
// - Comparaciones
// - Inventario
// - Productos estancados
// - Productos de mayor margen
// - Reposición sugerida
// - Alertas ejecutivas
// ============================================================

export type CeoSale = {
  id: string;
  total: number;
  created_at: string;
};

export type CeoSaleItem = {
  sale_id: string;
  name_snapshot: string;
  quantity: number;
  total: number;
  product_id: string | null;
  variant_id: string | null;
  unit_cost: number | null;
  cost_total: number | null;
};

export type CeoProduct = {
  id: string;
  name: string;
  cost: number;
  price: number;
};

export type CeoExpense = {
  amount: number;
};

export type CeoInventoryItem = {
  id: string;
  product_id: string;
  variant_id: string | null;

  product_name: string;
  sku: string | null;
  barcode: string | null;

  price: number;
  cost: number;

  image_url?: string | null;
  emoji?: string | null;
  is_active?: boolean;

  stock: number;
  reserved_stock: number;
  available_stock: number;

  min_stock: number;
  max_stock: number | null;

  stock_status?: string;
};

export type CeoProductPerformance = {
  productId: string | null;
  variantId: string | null;
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type CeoReplenishment = {
  productId: string;
  variantId: string | null;
  name: string;

  available: number;
  minimum: number;
  maximum: number | null;

  unitsSold30: number;
  dailyVelocity: number;

  daysOfStock: number | null;
  suggestedUnits: number;

  estimatedCost: number;
  estimatedRetail: number;

  priority:
    | "critical"
    | "high"
    | "medium";
};

export type CeoAlert = {
  type:
    | "out_of_stock"
    | "low_stock"
    | "stagnant"
    | "margin"
    | "sales"
    | "inventory";

  priority:
    | "critical"
    | "high"
    | "medium"
    | "info";

  title: string;
  description: string;
};

export type CeoAnalysis = {
  todaySales: number;
  yesterdaySales: number;

  last7Sales: number;
  previous7Sales: number;

  last30Sales: number;
  previousSales: number;

  monthSales: number;

  todayTickets: number;
  yesterdayTickets: number;

  tickets7: number;
  previousTickets7: number;

  tickets30: number;
  previousTickets: number;

  monthTickets: number;

  averageTicket: number;
  todayAverageTicket: number;
  yesterdayAverageTicket: number;

  change: number;
  change7: number;

  revenue: number;
  historicalCost: number;

  grossProfit: number;
  margin: number;

  expensesTotal: number;
  netProfit: number;

  unitsSold30: number;
  averageUnitsPerSale: number;

  uniqueProductsSold: number;

  inventoryUnits: number;
  inventoryAvailable: number;
  inventoryReserved: number;

  inventoryCost: number;
  inventoryRetail: number;

  inventoryCoverage: number;

  lowStock: CeoInventoryItem[];
  outOfStock: CeoInventoryItem[];
  stagnant: CeoInventoryItem[];

  topProducts: CeoProductPerformance[];
  topProfitProducts: CeoProductPerformance[];

  catalogMargins: Array<{
    id: string;
    name: string;
    price: number;
    cost: number;
    margin: number;
  }>;

  replenishment: CeoReplenishment[];

  alerts: CeoAlert[];
};

function sumSales(rows: CeoSale[]): number {
  return rows.reduce(
    (total, sale) =>
      total + Number(sale.total ?? 0),
    0,
  );
}

function percentageChange(
  current: number,
  previous: number,
): number {
  if (previous > 0) {
    return (
      ((current - previous) /
        previous) *
      100
    );
  }

  if (current > 0) {
    return 100;
  }

  return 0;
}

function startOfDayOffset(
  base: Date,
  daysAgo: number,
): Date {
  const result = new Date(base);

  result.setHours(
    0,
    0,
    0,
    0,
  );

  result.setDate(
    result.getDate() -
      daysAgo,
  );

  return result;
}

function getSalesBetween(
  rows: CeoSale[],
  start: Date,
  end: Date,
): CeoSale[] {
  const startTime =
    start.getTime();

  const endTime =
    end.getTime();

  return rows.filter(
    (sale) => {
      const time =
        new Date(
          sale.created_at,
        ).getTime();

      return (
        time >= startTime &&
        time < endTime
      );
    },
  );
}

function getHistoricalCost(
  item: CeoSaleItem,
): number {
  if (
    item.cost_total !== null &&
    item.cost_total !== undefined
  ) {
    return Number(
      item.cost_total,
    );
  }

  return (
    Number(
      item.unit_cost ?? 0,
    ) *
    Number(
      item.quantity ?? 0,
    )
  );
}

export function buildCeoAnalysis({
  now = new Date(),

  salesToday,
  sales30,
  salesPrevious,
  salesMonth,

  saleItems,

  inventory,

  products,

  expenses,
}: {
  now?: Date;

  salesToday: CeoSale[];
  sales30: CeoSale[];
  salesPrevious: CeoSale[];
  salesMonth: CeoSale[];

  saleItems: CeoSaleItem[];

  inventory: CeoInventoryItem[];

  products: CeoProduct[];

  expenses: CeoExpense[];
}): CeoAnalysis {
  const todayStart =
    startOfDayOffset(
      now,
      0,
    );

  const tomorrowStart =
    new Date(
      todayStart,
    );

  tomorrowStart.setDate(
    tomorrowStart.getDate() +
      1,
  );

  const yesterdayStart =
    startOfDayOffset(
      now,
      1,
    );

  const last7Start =
    startOfDayOffset(
      now,
      6,
    );

  const last8Start =
    startOfDayOffset(
      now,
      7,
    );

  const previous7Start =
    startOfDayOffset(
      now,
      13,
    );

  const current7 =
    getSalesBetween(
      sales30,
      last7Start,
      tomorrowStart,
    );

  // Los 7 días anteriores también deben salir
  // de sales30, ya que sales30 contiene los
  // últimos 30 días completos disponibles.
  //
  // salesPrevious corresponde al periodo
  // anterior de 30 días y se utiliza para
  // la comparación mensual.
  const previous7 =
    getSalesBetween(
      sales30,
      previous7Start,
      last8Start,
    );

  const todayRows =
    getSalesBetween(
      salesToday,
      todayStart,
      tomorrowStart,
    );

  const yesterdayRows =
    getSalesBetween(
      sales30,
      yesterdayStart,
      todayStart,
    );

  const todaySales =
    sumSales(todayRows);

  const yesterdaySales =
    sumSales(
      yesterdayRows,
    );

  const last7Sales =
    sumSales(current7);

  const previous7Sales =
    sumSales(previous7);

  const last30Sales =
    sumSales(sales30);

  const previousSales =
    sumSales(
      salesPrevious,
    );

  const monthSales =
    sumSales(
      salesMonth,
    );

  let revenue = 0;
  let historicalCost = 0;
  let unitsSold30 = 0;

  const productMap =
    new Map<
      string,
      CeoProductPerformance
    >();

  const soldProductIds =
    new Set<string>();

  for (const item of saleItems) {
    const quantity =
      Number(
        item.quantity ?? 0,
      );

    const itemRevenue =
      Number(
        item.total ?? 0,
      );

    const itemCost =
      getHistoricalCost(
        item,
      );

    revenue +=
      itemRevenue;

    historicalCost +=
      itemCost;

    unitsSold30 +=
      quantity;

    if (item.product_id) {
      soldProductIds.add(
        item.product_id,
      );
    }

    const key =
      item.variant_id
        ? `${item.product_id ?? "unknown"}:${item.variant_id}`
        : item.product_id ??
          `snapshot:${item.name_snapshot}`;

    const current =
      productMap.get(key);

    if (current) {
      current.quantity +=
        quantity;

      current.revenue +=
        itemRevenue;

      current.cost +=
        itemCost;

      current.profit =
        current.revenue -
        current.cost;

      current.margin =
        current.revenue > 0
          ? (current.profit /
              current.revenue) *
            100
          : 0;
    } else {
      const profit =
        itemRevenue -
        itemCost;

      productMap.set(
        key,
        {
          productId:
            item.product_id,
          variantId:
            item.variant_id,
          name:
            item.name_snapshot,
          quantity,
          revenue:
            itemRevenue,
          cost:
            itemCost,
          profit,
          margin:
            itemRevenue > 0
              ? (profit /
                  itemRevenue) *
                100
              : 0,
        },
      );
    }
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

  const change =
    percentageChange(
      last30Sales,
      previousSales,
    );

  const change7 =
    percentageChange(
      last7Sales,
      previous7Sales,
    );

  const topProducts =
    Array.from(
      productMap.values(),
    )
      .sort(
        (a, b) =>
          b.revenue -
          a.revenue,
      )
      .slice(0, 20);

  const topProfitProducts =
    Array.from(
      productMap.values(),
    )
      .sort(
        (a, b) =>
          b.profit -
          a.profit,
      )
      .slice(0, 20);

  const catalogMargins =
    products
      .map((product) => {
        const price =
          Number(
            product.price ?? 0,
          );

        const cost =
          Number(
            product.cost ?? 0,
          );

        return {
          id: product.id,
          name: product.name,
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

  const lowStock =
    inventory
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
    inventory.filter(
      (item) =>
        Number(
          item.available_stock ??
            0,
        ) <= 0,
    );

  const stagnant =
    inventory
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
      .sort(
        (a, b) =>
          Number(
            b.available_stock ??
              0,
          ) -
          Number(
            a.available_stock ??
              0,
          ),
      )
      .slice(0, 30);

  const unitsByProduct =
    new Map<string, number>();

  for (const item of saleItems) {
    if (!item.product_id) {
      continue;
    }

    const current =
      unitsByProduct.get(
        item.product_id,
      ) ?? 0;

    unitsByProduct.set(
      item.product_id,
      current +
        Number(
          item.quantity ?? 0,
        ),
    );
  }

  const replenishment =
    inventory
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
      .map(
        (
          item,
        ): CeoReplenishment => {
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

          const unitsSold30 =
            item.product_id
              ? Number(
                  unitsByProduct.get(
                    item.product_id,
                  ) ?? 0,
                )
              : 0;

          const dailyVelocity =
            unitsSold30 / 30;

          const daysOfStock =
            dailyVelocity > 0
              ? available /
                dailyVelocity
              : null;

          let suggestedUnits =
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
            suggestedUnits =
              Math.max(
                maximum -
                  available,
                suggestedUnits,
              );
          }

          const priority =
            available <= 0
              ? "critical"
              : daysOfStock !==
                    null &&
                daysOfStock <=
                  7
                ? "high"
                : "medium";

          return {
            productId:
              item.product_id,
            variantId:
              item.variant_id,
            name:
              item.product_name,

            available,
            minimum,
            maximum,

            unitsSold30,
            dailyVelocity,

            daysOfStock,
            suggestedUnits,

            estimatedCost:
              suggestedUnits *
              Number(
                item.cost ?? 0,
              ),

            estimatedRetail:
              suggestedUnits *
              Number(
                item.price ?? 0,
              ),

            priority,
          };
        },
      )
      .sort((a, b) => {
        const priorityValue =
          {
            critical: 0,
            high: 1,
            medium: 2,
          };

        return (
          priorityValue[
            a.priority
          ] -
          priorityValue[
            b.priority
          ]
        );
      });

  const inventoryUnits =
    inventory.reduce(
      (total, item) =>
        total +
        Number(
          item.stock ?? 0,
        ),
      0,
    );

  const inventoryAvailable =
    inventory.reduce(
      (total, item) =>
        total +
        Number(
          item.available_stock ??
            0,
        ),
      0,
    );

  const inventoryReserved =
    inventory.reduce(
      (total, item) =>
        total +
        Number(
          item.reserved_stock ??
            0,
        ),
      0,
    );

  const inventoryCost =
    inventory.reduce(
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
    inventory.reduce(
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

  const alerts: CeoAlert[] =
    [];

  if (
    outOfStock.length > 0
  ) {
    alerts.push({
      type:
        "out_of_stock",
      priority:
        "critical",
      title:
        `${outOfStock.length} productos agotados`,
      description:
        "Hay productos sin existencia disponible. Revisar reposición.",
    });
  }

  if (
    lowStock.length > 0
  ) {
    alerts.push({
      type:
        "low_stock",
      priority:
        "high",
      title:
        `${lowStock.length} productos bajo mínimo`,
      description:
        "El inventario disponible está en el mínimo configurado o por debajo.",
    });
  }

  if (
    stagnant.length > 0
  ) {
    alerts.push({
      type:
        "stagnant",
      priority:
        "medium",
      title:
        `${stagnant.length} productos sin movimiento`,
      description:
        "Tienen existencia disponible pero no aparecen en ventas de los últimos 30 días.",
    });
  }

  if (
    change < -10 &&
    last30Sales > 0
  ) {
    alerts.push({
      type:
        "sales",
      priority:
        "high",
      title:
        "Las ventas bajaron",
      description:
        `Las ventas de los últimos 30 días cambiaron ${change.toFixed(
          1,
        )}% contra los 30 días anteriores.`,
    });
  }

  if (
    change > 10
  ) {
    alerts.push({
      type:
        "sales",
      priority:
        "info",
      title:
        "Las ventas aumentaron",
      description:
        `Las ventas de los últimos 30 días cambiaron +${change.toFixed(
          1,
        )}% contra los 30 días anteriores.`,
    });
  }

  if (
    margin < 30 &&
    revenue > 0
  ) {
    alerts.push({
      type:
        "margin",
      priority:
        "high",
      title:
        "Margen bruto reducido",
      description:
        `El margen bruto calculado sobre las ventas analizadas es de ${margin.toFixed(
          1,
        )}%.`,
    });
  }

  if (
    inventoryCoverage < 1 &&
    last30Sales > 0
  ) {
    alerts.push({
      type:
        "inventory",
      priority:
        "high",
      title:
        "Inventario con cobertura baja",
      description:
        "El valor de inventario disponible es inferior a las ventas de los últimos 30 días.",
    });
  }

  const uniqueProductsSold =
    new Set(
      saleItems
        .map(
          (item) =>
            item.product_id,
        )
        .filter(Boolean),
    ).size;

  return {
    todaySales,
    yesterdaySales,

    last7Sales,
    previous7Sales,

    last30Sales,
    previousSales,

    monthSales,

    todayTickets:
      todayRows.length,

    yesterdayTickets:
      yesterdayRows.length,

    tickets7:
      current7.length,

    previousTickets7:
      previous7.length,

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
      todayRows.length > 0
        ? todaySales /
          todayRows.length
        : 0,

    yesterdayAverageTicket:
      yesterdayRows.length >
      0
        ? yesterdaySales /
          yesterdayRows.length
        : 0,

    change,
    change7,

    revenue,
    historicalCost,

    grossProfit,
    margin,

    expensesTotal,
    netProfit,

    unitsSold30,
    averageUnitsPerSale:
      sales30.length > 0
        ? unitsSold30 /
          sales30.length
        : 0,

    uniqueProductsSold,

    inventoryUnits,
    inventoryAvailable,
    inventoryReserved,

    inventoryCost,
    inventoryRetail,

    inventoryCoverage,

    lowStock,
    outOfStock,
    stagnant,

    topProducts,
    topProfitProducts,
    catalogMargins,

    replenishment,

    alerts,
  };
}