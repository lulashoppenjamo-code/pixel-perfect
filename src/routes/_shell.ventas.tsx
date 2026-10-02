/**
 * Historial de ventas — LULA OS
 * Ruta: src/routes/_shell.ventas.tsx
 *
 * Lista de tickets de la sucursal activa con filtros por fecha, método de pago
 * y estado, totales del periodo y reimpresión de ticket.
 *
 * La configuración de ticket utiliza esta prioridad:
 * 1. Configuración específica de la sucursal activa.
 * 2. Configuración global.
 * 3. Valor predeterminado.
 *
 * El punto de venta está en Caja (/caja).
 */

import { useMemo, useState } from "react";
import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Printer,
  RotateCcw,
  Search,
  ChevronDown,
  ChevronUp,
  Banknote,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  TicketModal,
  type TicketData,
} from "@/components/pos/TicketModal";

export const Route = createFileRoute(
  "/_shell/ventas",
)({
  head: () => ({
    meta: [
      {
        title:
          "Historial de ventas — Lula OS",
      },
      {
        name: "description",
        content:
          "Consulta y reimprime los tickets de tu sucursal.",
      },
      {
        property: "og:title",
        content:
          "Historial de ventas — Lula OS",
      },
      {
        property: "og:description",
        content:
          "Todos los tickets de tu sucursal, con filtros y totales.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="ventas">
      <VentasPage />
    </RequireNavAccess>
  ),
});

type SaleRow = {
  id: string;
  folio: number;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
  customerName: string | null;
  itemCount: number;
  items: { name: string; quantity: number }[];
};

type TicketSettingRow = {
  key: string;
  value: unknown;
  branch_id: string | null;
};

const ALL = "all";

const dayInput = (d: Date) =>
  d.toISOString().slice(0, 10);

function paymentLabel(method: string) {
  switch (method) {
    case "cash":
      return "Cash";
    case "transfer":
      return "Transferencia";
    case "card":
      return "Tarjeta";
    case "credit":
      return "Crédito";
    case "mixed":
      return "Mixto";
    default:
      return method;
  }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

function readSettingValue(
  rows: TicketSettingRow[],
  key: string,
  branchId: string | null,
  fallback: string,
) {
  /*
   * IMPORTANTE:
   *
   * La configuración de sucursal tiene prioridad
   * sobre la configuración global.
   *
   * Esto evita que, por ejemplo, una sucursal tenga
   * un nombre/footer diferente y el sistema tome
   * accidentalmente el valor global.
   */
  const branchRow = rows.find(
    (row) =>
      row.key === key &&
      row.branch_id === branchId,
  );

  const globalRow = rows.find(
    (row) =>
      row.key === key &&
      row.branch_id === null,
  );

  const raw =
    branchRow?.value ??
    globalRow?.value;

  if (typeof raw === "string") {
    return raw;
  }

  if (
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return String(raw);
  }

  /*
   * Para JSON complejo intentamos obtener una
   * representación legible, pero evitamos mostrar
   * [object Object].
   */
  if (
    raw !== null &&
    typeof raw === "object"
  ) {
    try {
      return JSON.stringify(raw);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function VentasPage() {
  const {
    branchId,
    branches,
  } = useBranch();

  const navigate =
    useNavigate();

  const today = new Date();

  const [
    from,
    setFrom,
  ] = useState(
    dayInput(today),
  );

  const [
    to,
    setTo,
  ] = useState(
    dayInput(today),
  );

  const [
    method,
    setMethod,
  ] = useState<string>(
    ALL,
  );

  const [
    status,
    setStatus,
  ] = useState<string>(
    ALL,
  );

  const [
    query,
    setQuery,
  ] = useState("");

  const [
    ticket,
    setTicket,
  ] =
    useState<TicketData | null>(
      null,
    );

  const [
    ticketOpen,
    setTicketOpen,
  ] = useState(false);

  const [listTab, setListTab] = useState<"tpv" | "online">("tpv");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [activeSaleStatus, setActiveSaleStatus] = useState<string | null>(null);
  const qc = useQueryClient();

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: [
      "sales-history",
      branchId,
      from,
      to,
      method,
      status,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          "id, folio, total, payment_method, status, created_at, customer_id, customers(name), sale_items(name_snapshot, quantity)",
        )
        .eq(
          "branch_id",
          branchId!,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        )
        .limit(300);

      /*
       * Los días se interpretan en la zona horaria
       * del dispositivo.
       */
      if (from) {
        q = q.gte(
          "created_at",
          new Date(
            `${from}T00:00:00`,
          ).toISOString(),
        );
      }

      if (to) {
        q = q.lte(
          "created_at",
          new Date(
            `${to}T23:59:59.999`,
          ).toISOString(),
        );
      }

      if (method !== ALL) {
        q = q.eq(
          "payment_method",
          method as
            | "cash"
            | "card"
            | "transfer"
            | "credit"
            | "mixed",
        );
      }

      if (status !== ALL) {
        q = q.eq(
          "status",
          status as
            | "completed"
            | "cancelled"
            | "refunded"
            | "partially_refunded",
        );
      }

      const {
        data,
        error,
      } = await q;

      if (error) {
        throw error;
      }

      return (
        data ?? []
      ).map((row) => {
        const embedded =
          (
            row as {
              customers?:
                | {
                    name?:
                      | string
                      | null;
                  }
                | {
                    name?:
                      | string
                      | null;
                  }[]
                | null;
            }
          ).customers;

        const customerName =
          Array.isArray(
            embedded,
          )
            ? (
                embedded[0]
                  ?.name ??
                null
              )
            : (
                embedded?.name ??
                null
              );

        const rawItems = (
          row as {
            sale_items?:
              | {
                  name_snapshot?: string | null;
                  quantity?: number | null;
                }[]
              | null;
          }
        ).sale_items;

        const items = (rawItems ?? []).map((item) => ({
          name: item.name_snapshot ?? "Artículo",
          quantity: Number(item.quantity ?? 0),
        }));

        const itemCount = items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );

        return {
          id: row.id,
          folio: row.folio,
          total: Number(
            row.total,
          ),
          payment_method:
            row.payment_method,
          status:
            row.status,
          created_at:
            row.created_at,
          customerName,
          itemCount,
          items,
        } satisfies SaleRow;
      });
    },
  });

  const visible =
    useMemo(() => {
      const q =
        query
          .trim()
          .toLowerCase();

      if (!q) {
        return rows;
      }

      return rows.filter(
        (row) =>
          String(
            row.folio,
          ).includes(q) ||
          (
            row.customerName ??
            ""
          )
            .toLowerCase()
            .includes(q),
      );
    }, [
      rows,
      query,
    ]);

  const totals =
    useMemo(() => {
      const completed =
        visible.filter(
          (row) =>
            row.status ===
            "completed",
        );

      const sum =
        completed.reduce(
          (
            total,
            row,
          ) =>
            total +
            row.total,
          0,
        );

      return {
        tickets:
          completed.length,

        sum,

        avg:
          completed.length
            ? sum /
              completed.length
            : 0,
      };
    }, [
      visible,
    ]);

  /*
   * Reimpresión de ticket.
   *
   * La venta siempre se consulta por ID y la seguridad
   * de Supabase/RLS determina si el usuario puede verla.
   *
   * La configuración se consulta junto con branch_id
   * para poder distinguir entre configuración global
   * y configuración específica de sucursal.
   */
  const reprint =
    useMutation({
      mutationFn:
        async (
          saleId: string,
        ) => {
          const {
            data: sale,
            error,
          } = await supabase
            .from("sales")
            .select(
              "id, folio, subtotal, tax, discount, total, payment_method, cash_received, change_given, created_at, customer_id, notes, branch_id, cashier_id",
            )
            .eq(
              "id",
              saleId,
            )
            .single();

          if (error) {
            throw error;
          }

          const [
            itemsResult,
            customerResult,
            settingsResult,
            branchResult,
          ] =
            await Promise.all([
              supabase
                .from(
                  "sale_items",
                )
                .select(
                  "name_snapshot, quantity, unit_price, discount, total",
                )
                .eq(
                  "sale_id",
                  saleId,
                ),

              sale.customer_id
                ? supabase
                    .from(
                      "customers",
                    )
                    .select(
                      "name",
                    )
                    .eq(
                      "id",
                      sale.customer_id,
                    )
                    .maybeSingle()
                : Promise.resolve(
                    {
                      data: null,
                      error:
                        null,
                    },
                  ),

              /*
               * RLS permite la configuración global y
               * la configuración de la sucursal accesible.
               */
              supabase
                .from(
                  "settings",
                )
                .select(
                  "key, value, branch_id",
                ),

              supabase
                .from(
                  "branches",
                )
                .select(
                  "name",
                )
                .eq(
                  "id",
                  sale.branch_id,
                )
                .maybeSingle(),
            ]);

          if (
            itemsResult.error
          ) {
            throw itemsResult.error;
          }

          if (
            customerResult.error
          ) {
            throw customerResult.error;
          }

          if (
            settingsResult.error
          ) {
            throw settingsResult.error;
          }

          const settings =
            (
              settingsResult.data ??
              []
            ) as TicketSettingRow[];

          const companyName =
            readSettingValue(
              settings,
              "company_name",
              sale.branch_id,
              "Lula Shop",
            );

          const footer =
            readSettingValue(
              settings,
              "ticket_footer",
              sale.branch_id,
              "¡Gracias por su compra!",
            );

          const branchName =
            branchResult.data
              ?.name ??
            branches.find(
              (branch) =>
                branch.id ===
                sale.branch_id,
            )?.name ??
            "";

          return {
            sale,
            items:
              itemsResult.data ??
              [],
            customerName:
              customerResult
                .data
                ?.name ??
              undefined,
            companyName,
            branchName,
            footer,
          };
        },

      onSuccess: ({
        sale,
        items,
        customerName,
        companyName,
        branchName,
        footer,
      }) => {
        setTicket({
          companyName,

          branchName,

          folio:
            sale.folio,

          date:
            new Date(
              sale.created_at,
            ).toLocaleString(
              "es-MX",
            ),

          cashierName: "",

          customerName,

          paymentMethod:
            sale.payment_method,

          lines:
            items.map(
              (line) => ({
                name:
                  line.name_snapshot,

                quantity:
                  Number(
                    line.quantity,
                  ),

                unit_price:
                  Number(
                    line.unit_price,
                  ),

                discount:
                  Number(
                    line.discount,
                  ),

                total:
                  Number(
                    line.total,
                  ),
              }),
            ),

          subtotal:
            Number(
              sale.subtotal,
            ),

          tax:
            Number(
              sale.tax,
            ),

          discount:
            Number(
              sale.discount,
            ),

          total:
            Number(
              sale.total,
            ),

          cashReceived:
            sale.cash_received !=
            null
              ? Number(
                  sale.cash_received,
                )
              : null,

          changeGiven:
            sale.change_given !=
            null
              ? Number(
                  sale.change_given,
                )
              : null,

          footer,
        });

        setTicketOpen(
          true,
        );
      },

      onError: (
        error: Error,
      ) =>
        toast.error(
          error.message ||
            "No se pudo abrir el ticket.",
        ),
    });

  const cancelSale = useMutation({
    mutationFn: async ({
      saleId,
      reason,
    }: {
      saleId: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc("cancel_sale", {
        _sale_id: saleId,
        _reason: reason ?? "Cancelación desde Hoy",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sales-history"] });
      void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
      void qc.invalidateQueries({ queryKey: ["open-cash"] });
      setTicketOpen(false);
      setTicket(null);
      setActiveSaleId(null);
      setActiveSaleStatus(null);
      toast.success("Venta cancelada. Stock restaurado.");
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo cancelar la venta");
    },
  });

  const activeBranchName =
    branches.find((b) => b.id === branchId)?.name ?? "Sucursal";

  const folioLabel = (folio: number) => {
    const prefix = activeBranchName
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 4)
      .toUpperCase() || "LULA";
    return `${prefix}-${folio}`;
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 pb-2 md:max-w-3xl">
      {/* Tabs estilo Zobaze: Recibos de TPV | Pedidos en línea */}
      <div className="flex overflow-hidden rounded-lg border border-[#e0e0e0] bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setListTab("tpv")}
          className={cn(
            "flex-1 px-3 py-2.5 text-sm font-semibold transition-colors",
            listTab === "tpv"
              ? "bg-[#1a73e8] text-white"
              : "bg-white text-[#1a73e8]",
          )}
        >
          Recibos de TPV
        </button>
        <button
          type="button"
          onClick={() => setListTab("online")}
          className={cn(
            "flex-1 px-3 py-2.5 text-sm font-semibold transition-colors",
            listTab === "online"
              ? "bg-[#1a73e8] text-white"
              : "bg-white text-[#1a73e8]",
          )}
        >
          Pedidos en línea
        </button>
      </div>

      {/* Filtros compactos (misma lógica, UI más ligera) */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e0e0e0] bg-white p-2.5">
        <Input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-9 w-[8.5rem] rounded-lg border-[#e0e0e0] text-xs"
        />
        <span className="text-xs text-[#9aa3b8]">a</span>
        <Input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="h-9 w-[8.5rem] rounded-lg border-[#e0e0e0] text-xs"
        />
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="h-9 w-32 rounded-lg border-[#e0e0e0] text-xs">
            <SelectValue placeholder="Método" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            <SelectItem value="cash">Efectivo</SelectItem>
            <SelectItem value="card">Tarjeta</SelectItem>
            <SelectItem value="transfer">Transferencia</SelectItem>
            <SelectItem value="credit">Crédito</SelectItem>
            <SelectItem value="mixed">Mixto</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-32 rounded-lg border-[#e0e0e0] text-xs">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            <SelectItem value="completed">Completada</SelectItem>
            <SelectItem value="cancelled">Cancelada</SelectItem>
            <SelectItem value="refunded">Reembolsada</SelectItem>
            <SelectItem value="partially_refunded">Parcial</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9e9e9e]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar folio o cliente"
            className="h-9 rounded-lg border-[#e0e0e0] pl-8 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-lg border-[#e0e0e0] text-xs"
          onClick={() => {
            setFrom(dayInput(today));
            setTo(dayInput(today));
            setMethod(ALL);
            setStatus(ALL);
            setQuery("");
          }}
        >
          Hoy
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-lg border-[#e0e0e0] text-xs"
          onClick={() => navigate({ to: "/devoluciones" })}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Devoluciones
        </Button>
      </div>

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          No se pudo cargar el historial de ventas. Revisa tu conexión o permisos.
        </div>
      )}

      {/* Resumen del periodo (conservado) */}
      <div className="grid grid-cols-3 gap-2">
        <Card label="Tickets" value={String(totals.tickets)} />
        <Card label="Ventas" value={money(totals.sum)} />
        <Card label="Promedio" value={money(totals.avg)} />
      </div>

      {/* Lista estilo Zobaze */}
      {listTab === "online" ? (
        <div className="rounded-xl border border-[#e0e0e0] bg-white px-4 py-12 text-center">
          <p className="text-base font-bold text-[#212121]">
            Pedidos en línea
          </p>
          <p className="mt-1 text-sm text-[#757575]">
            No hay pedidos en línea por ahora.
          </p>
        </div>
      ) : isLoading ? (
        <p className="py-10 text-center text-sm text-[#9aa3b8]">
          Cargando…
        </p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[#e0e0e0] bg-white px-6 py-14 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e8f0fe] text-3xl">
            📭
          </div>
          <div>
            <p className="text-base font-bold text-[#212121]">
              No hay transacciones hoy
            </p>
            <p className="mt-1 text-sm text-[#757575]">
              Ajusta el filtro de fechas o realiza una venta en Caja
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((row) => {
            const open = expandedId === row.id;
            const units =
              row.itemCount > 0
                ? row.itemCount
                : 0;
            return (
              <div
                key={row.id}
                className="overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-3 py-3 text-left active:bg-[#fafafa]"
                  onClick={() =>
                    setExpandedId(open ? null : row.id)
                  }
                >
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e8f5e9] text-[#2e7d32]">
                    <Banknote className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-[#212121]">
                      {folioLabel(row.folio)}
                    </p>
                    <p className="text-sm text-[#616161]">
                      por {paymentLabel(row.payment_method)}
                    </p>
                    <p className="text-xs text-[#9e9e9e]">
                      {units}{" "}
                      {units === 1 ? "Artículo" : "Artículos"}{" "}
                      {timeAgo(row.created_at)}
                      {row.status !== "completed" && (
                        <span className="ml-1 text-[#e5484d]">
                          ·{" "}
                          {row.status === "cancelled"
                            ? "Cancelada"
                            : row.status === "refunded"
                              ? "Reembolsada"
                              : row.status === "partially_refunded"
                                ? "Parcial"
                                : row.status}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-base font-bold text-[#1a73e8]">
                      {money(row.total)}
                    </span>
                    {open ? (
                      <ChevronUp className="h-4 w-4 text-[#9e9e9e]" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-[#9e9e9e]" />
                    )}
                  </div>
                </button>

                {open && (
                  <div className="border-t border-[#eeeeee] bg-white">
                    {row.items.length > 0 ? (
                      row.items.map((item, idx) => (
                        <div
                          key={`${row.id}-${idx}`}
                          className="flex items-center justify-between border-b border-[#f0f0f0] px-3 py-2 last:border-b-0"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-[#616161]">
                            {item.name}
                          </span>
                          <span className="ml-3 shrink-0 text-sm text-[#757575]">
                            x {item.quantity}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-[#9e9e9e]">
                        Sin detalle de artículos
                      </p>
                    )}
                    <div className="flex gap-2 border-t border-[#eeeeee] p-2.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1 rounded-lg border-[#e0e0e0] text-xs"
                        disabled={reprint.isPending}
                        onClick={() => {
                          setActiveSaleId(row.id);
                          setActiveSaleStatus(row.status);
                          reprint.mutate(row.id);
                        }}
                      >
                        <Printer className="mr-1.5 h-3.5 w-3.5" />
                        Ver ticket
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1 rounded-lg border-[#e0e0e0] text-xs"
                        onClick={() =>
                          navigate({ to: "/devoluciones" })
                        }
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Devolver
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <TicketModal
        open={ticketOpen}
        onOpenChange={(open) => {
          setTicketOpen(open);
          if (!open) {
            setActiveSaleId(null);
            setActiveSaleStatus(null);
          }
        }}
        ticket={ticket}
        variant="fullscreen"
        canDelete={activeSaleStatus === "completed"}
        actionsPending={cancelSale.isPending}
        onReturn={() => {
          setTicketOpen(false);
          navigate({ to: "/devoluciones" });
        }}
        onDelete={() => {
          if (!activeSaleId) return;
          const ok = window.confirm(
            "¿Borrar esta venta? Se cancelará el ticket y se restaurará el stock.",
          );
          if (!ok) return;
          cancelSale.mutate({ saleId: activeSaleId });
        }}
        onEdit={() => {
          toast.message("La edición de tickets estará disponible pronto.");
        }}
      />
    </div>
  );
}

function Card({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e0e0e0] bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#9aa3b8]">
        {label}
      </p>

      <p className="mt-1 text-lg font-bold text-[#212121]">
        {value}
      </p>
    </div>
  );
}