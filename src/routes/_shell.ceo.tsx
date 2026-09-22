import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Send, Sparkles } from "lucide-react";
import { subDays, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/ceo")({
  head: () => ({
    meta: [{ title: "CEO IA — Lula OS" }],
  }),
  component: CeoPage,
});

type Msg = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "¿Cómo están las ventas hoy?",
  "¿Qué productos se están vendiendo más?",
  "¿Qué productos están por agotarse?",
  "¿Cuál es el ticket promedio?",
  "¿Cuál es la utilidad estimada?",
  "¿Cómo van las ventas vs el periodo anterior?",
  "¿Qué debo comprar?",
  "¿Qué productos tienen mayor margen?",
];

function CeoPage() {
  const { branchId, branches } = useBranch();
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "Sucursal";
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: `Hola. Soy el asistente CEO de LULA OS (${branchName}). Pregúntame por ventas, stock, márgenes o qué comprar.`,
    },
  ]);
  const [thinking, setThinking] = useState(false);

  const since30 = startOfDay(subDays(new Date(), 30)).toISOString();
  const since7 = startOfDay(subDays(new Date(), 7)).toISOString();
  const todayStart = startOfDay(new Date()).toISOString();
  const prev30 = startOfDay(subDays(new Date(), 60)).toISOString();

  const { data: sales30 = [] } = useQuery({
    queryKey: ["ceo-sales-30", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, total, created_at, status")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", since30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: salesToday = [] } = useQuery({
    queryKey: ["ceo-sales-today", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, total, created_at")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", todayStart);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: salesPrev = [] } = useQuery({
    queryKey: ["ceo-sales-prev", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, total")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", prev30)
        .lt("created_at", since30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const saleIds = sales30.map((s) => s.id);

  const { data: items = [] } = useQuery({
    queryKey: ["ceo-items", saleIds.slice(0, 200).join(",")],
    enabled: saleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("name_snapshot, quantity, total, product_id, unit_price")
        .in("sale_id", saleIds.slice(0, 200));
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ["ceo-inventory", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("stock, min_stock, reserved_stock, product_id, products(name, cost, price)")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["ceo-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, cost, price")
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const answer = (q: string): string => {
    const text = q.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

    const totalToday = salesToday.reduce((a, s) => a + Number(s.total), 0);
    const total30 = sales30.reduce((a, s) => a + Number(s.total), 0);
    const totalPrev = salesPrev.reduce((a, s) => a + Number(s.total), 0);
    const tickets30 = sales30.length;
    const avgTicket = tickets30 ? total30 / tickets30 : 0;
    const change =
      totalPrev > 0 ? ((total30 - totalPrev) / totalPrev) * 100 : total30 > 0 ? 100 : 0;

    // Top productos
    const topMap = new Map<string, { qty: number; total: number; product_id: string | null }>();
    for (const it of items) {
      const k = it.name_snapshot;
      const cur = topMap.get(k) ?? { qty: 0, total: 0, product_id: it.product_id };
      cur.qty += Number(it.quantity);
      cur.total += Number(it.total);
      topMap.set(k, cur);
    }
    const topList = Array.from(topMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty);

    const costMap = new Map(products.map((p) => [p.id, Number(p.cost) || 0]));
    const priceMap = new Map(products.map((p) => [p.id, Number(p.price) || 0]));

    let revenue = 0;
    let costSum = 0;
    for (const it of items) {
      revenue += Number(it.total);
      const c = it.product_id ? costMap.get(it.product_id) ?? 0 : 0;
      costSum += c * Number(it.quantity);
    }
    const utility = revenue - costSum;
    const marginPct = revenue > 0 ? (utility / revenue) * 100 : 0;

    // Low stock
    const low = inventory
      .filter((r) => Number(r.stock) <= Number(r.min_stock))
      .map((r) => {
        const p = r.products as { name?: string } | null;
        return {
          name: p?.name ?? "?",
          stock: Number(r.stock),
          min: Number(r.min_stock),
        };
      })
      .sort((a, b) => a.stock - b.stock);

    // Stagnant: products with stock but no sales in items
    const soldIds = new Set(items.map((i) => i.product_id).filter(Boolean));
    const stagnant = inventory
      .filter((r) => Number(r.stock) > 0 && r.product_id && !soldIds.has(r.product_id))
      .slice(0, 8)
      .map((r) => {
        const p = r.products as { name?: string } | null;
        return `${p?.name ?? "?"} (stock ${r.stock})`;
      });

    // Best margin products (catalog)
    const marginList = products
      .map((p) => {
        const price = Number(p.price);
        const cost = Number(p.cost);
        const m = price > 0 ? ((price - cost) / price) * 100 : 0;
        return { name: p.name, margin: m, price, cost };
      })
      .filter((p) => p.price > 0)
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 8);

    if (text.includes("hoy") && (text.includes("venta") || text.includes("como van") || text.includes("estan"))) {
      return `Hoy en ${branchName}:\n• ${salesToday.length} venta(s)\n• Total: ${money(totalToday)}\n• Ticket promedio hoy: ${salesToday.length ? money(totalToday / salesToday.length) : money(0)}`;
    }

    if (text.includes("ticket") && text.includes("promedio")) {
      return `Ticket promedio (últimos 30 días) en ${branchName}: ${money(avgTicket)} sobre ${tickets30} ventas.`;
    }

    if (
      text.includes("vendiendo mas") ||
      text.includes("mas vendidos") ||
      text.includes("top") ||
      (text.includes("productos") && text.includes("vend"))
    ) {
      if (!topList.length) return "No hay ventas registradas en los últimos 30 días para rankear productos.";
      const lines = topList
        .slice(0, 8)
        .map((p, i) => `${i + 1}. ${p.name} — ${p.qty} uds — ${money(p.total)}`)
        .join("\n");
      return `Productos más vendidos (30 días) en ${branchName}:\n${lines}`;
    }

    if (
      text.includes("agot") ||
      text.includes("bajo") ||
      text.includes("minimo") ||
      text.includes("por agotar") ||
      text.includes("stock bajo")
    ) {
      if (!low.length) return `No hay productos bajo el mínimo en ${branchName}.`;
      const lines = low
        .slice(0, 12)
        .map((p) => `• ${p.name}: ${p.stock} (mín ${p.min})`)
        .join("\n");
      return `Productos por agotarse / bajo mínimo:\n${lines}`;
    }

    if (text.includes("comprar") || text.includes("reponer") || text.includes("pedir")) {
      if (!low.length) return "Por ahora no hay alertas de reposición por mínimo. Revisa el conteo físico si sospechas descuadres.";
      const lines = low
        .slice(0, 10)
        .map((p) => `• ${p.name}: reponer al menos ${Math.max(p.min - p.stock, 1)} (stock ${p.stock})`)
        .join("\n");
      return `Sugerencia de compra según mínimos:\n${lines}`;
    }

    if (text.includes("utilidad") || text.includes("margen") || text.includes("ganancia")) {
      if (text.includes("mayor margen") || text.includes("mejor margen")) {
        if (!marginList.length) return "No hay productos con precio/costo para calcular margen.";
        const lines = marginList
          .map((p) => `• ${p.name}: ${p.margin.toFixed(1)}% (precio ${money(p.price)}, costo ${money(p.cost)})`)
          .join("\n");
        return `Productos con mayor margen de catálogo:\n${lines}`;
      }
      return `Utilidad estimada (30 días) en ${branchName}:\n• Ingresos: ${money(revenue)}\n• Costo estimado: ${money(costSum)}\n• Utilidad: ${money(utility)}\n• Margen: ${marginPct.toFixed(1)}%\n\nNota: el costo usa el costo actual del producto (no historial de costos por venta).`;
    }

    if (
      text.includes("anterior") ||
      text.includes("compar") ||
      text.includes("vs") ||
      text.includes("periodo") ||
      text.includes("respecto")
    ) {
      return `Comparación 30 días vs 30 anteriores en ${branchName}:\n• Actual: ${money(total30)} (${tickets30} tickets)\n• Anterior: ${money(totalPrev)}\n• Variación: ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
    }

    if (text.includes("estanc") || text.includes("no se vende") || text.includes("parados")) {
      if (!stagnant.length) return "No detecté productos con stock y sin ventas en el recorte analizado.";
      return `Posibles productos estancados (tienen stock y no aparecen en ventas recientes):\n${stagnant.map((s) => `• ${s}`).join("\n")}`;
    }

    if (text.includes("venta") || text.includes("resumen") || text.includes("como van")) {
      return `Resumen ${branchName} (30 días):\n• Ventas: ${money(total30)}\n• Tickets: ${tickets30}\n• Ticket promedio: ${money(avgTicket)}\n• Hoy: ${money(totalToday)} (${salesToday.length} ventas)\n• vs periodo anterior: ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
    }

    if (text.includes("sucursal") || text.includes("atencion")) {
      return `Estás viendo datos de: ${branchName}. Cambia de sucursal en el menú lateral para analizar otra. Los reportes y el POS usan la misma fuente de inventario y ventas.`;
    }

    return `Puedo ayudarte con:\n• Ventas de hoy / 30 días\n• Ticket promedio\n• Productos más vendidos\n• Stock bajo / qué comprar\n• Utilidad y margen\n• Comparación vs periodo anterior\n• Productos estancados\n\nPrueba una de las sugerencias o reformula la pregunta.`;
  };

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setThinking(true);
    // Simula latencia de análisis
    setTimeout(() => {
      const reply = answer(question);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      setThinking(false);
    }, 350);
  };

  return (
    <div className="flex h-[calc(100dvh-5rem)] flex-col p-4 md:h-[calc(100vh-1rem)] md:p-6">
      <PageHeader
        icon={Bot}
        title="CEO IA"
        description={`Analiza datos reales de ${branchName}. Listo para conectar un LLM externo.`}
        className="mb-4"
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Sparkles className="mr-1 inline h-3 w-3" />
            {s}
          </button>
        ))}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="shrink-0 border-b py-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Conversación
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                    m.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {m.text}
                </div>
              ))}
              {thinking && (
                <div className="w-fit rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                  Analizando datos…
                </div>
              )}
            </div>
          </ScrollArea>
          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta sobre el negocio…"
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={thinking || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
