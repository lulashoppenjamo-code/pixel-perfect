/**
 * Clientes — LULA OS
 * CRUD + historial + saldo crédito + abonos
 *
 * IMPORTANTE:
 * Los abonos se registran mediante RPC:
 *   register_credit_payment()
 *
 * No se inserta directamente en credit_payments desde el frontend.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, Search, Wallet, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_shell/clientes")({
  head: () => ({
    meta: [{ title: "Clientes — Lula OS" }],
  }),

  component: () => (
    <RequireNavAccess navKey="clientes">
      <ClientesPage />
    </RequireNavAccess>
  ),
});

type Form = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  address: string;
};

const empty: Form = {
  name: "",
  phone: "",
  email: "",
  notes: "",
  address: "",
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  address?: string | null;
};

type SaleCustomerRow = {
  customer_id: string | null;
  total: number;
  status: string;
  payment_method: string;
  created_at: string;
};

type CreditPaymentRow = {
  customer_id: string;
  amount: number;
};

function ClientesPage() {
  const { isManager } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();

  const [form, setForm] = useState<Form>(empty);
  const [search, setSearch] = useState("");

  const [payCustomerId, setPayCustomerId] =
    useState<string | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payNotes, setPayNotes] = useState("");

  // ============================================================
  // CLIENTES
  // ============================================================

  const {
    data: customers = [],
    isLoading,
  } = useQuery<CustomerRow[]>({
    queryKey: ["customers"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");

      if (error) throw error;

      return (data ?? []) as CustomerRow[];
    },
  });

  // ============================================================
  // VENTAS POR CLIENTE
  // ============================================================

  const {
    data: salesByCustomer = [],
  } = useQuery<SaleCustomerRow[]>({
    queryKey: ["customer-sales-agg"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          "customer_id, total, status, payment_method, created_at",
        )
        .not("customer_id", "is", null)
        .in("status", [
          "completed",
          "partially_refunded",
        ]);

      if (error) throw error;

      return (data ?? []) as SaleCustomerRow[];
    },
  });

  // ============================================================
  // ABONOS
  // ============================================================

  const {
    data: creditPayments = [],
  } = useQuery<CreditPaymentRow[]>({
    queryKey: ["credit-payments"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_payments")
        .select("customer_id, amount");

      if (error) {
        if (
          error.message?.includes("does not exist") ||
          error.code === "42P01"
        ) {
          return [];
        }

        throw error;
      }

      return (data ?? []) as CreditPaymentRow[];
    },
  });

  // ============================================================
  // ESTADÍSTICAS
  // ============================================================

  const stats = useMemo(() => {
    const map = new Map<
      string,
      {
        count: number;
        total: number;
        credit: number;
        last: string | null;
      }
    >();

    for (const sale of salesByCustomer) {
      if (!sale.customer_id) continue;

      const current =
        map.get(sale.customer_id) ?? {
          count: 0,
          total: 0,
          credit: 0,
          last: null,
        };

      current.count += 1;
      current.total += Number(sale.total ?? 0);

      if (sale.payment_method === "credit") {
        current.credit += Number(sale.total ?? 0);
      }

      if (
        !current.last ||
        sale.created_at > current.last
      ) {
        current.last = sale.created_at;
      }

      map.set(sale.customer_id, current);
    }

    const paid = new Map<string, number>();

    for (const payment of creditPayments) {
      paid.set(
        payment.customer_id,
        (paid.get(payment.customer_id) ?? 0) +
          Number(payment.amount ?? 0),
      );
    }

    for (const [customerId, current] of map) {
      current.credit = Math.max(
        0,
        current.credit -
          (paid.get(customerId) ?? 0),
      );
    }

    return map;
  }, [salesByCustomer, creditPayments]);

  // ============================================================
  // FILTRO
  // ============================================================

  const filtered = customers.filter((customer) => {
    if (!search.trim()) return true;

    const q = search.trim().toLowerCase();

    return (
      customer.name
        .toLowerCase()
        .includes(q) ||
      (customer.phone ?? "")
        .toLowerCase()
        .includes(q) ||
      (customer.email ?? "")
        .toLowerCase()
        .includes(q)
    );
  });

  // ============================================================
  // CREAR / ACTUALIZAR CLIENTE
  // ============================================================

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) {
        throw new Error("Nombre requerido");
      }

      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        address: form.address.trim() || null,
      };

      if (form.id) {
        const { error } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", form.id);

        if (error) throw error;

        return;
      }

      const { error } = await supabase
        .from("customers")
        .insert(payload);

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        form.id
          ? "Cliente actualizado"
          : "Cliente creado",
      );

      setForm(empty);

      void qc.invalidateQueries({
        queryKey: ["customers"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-customers"],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // ============================================================
  // ELIMINAR CLIENTE
  // ============================================================

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Cliente eliminado");

      void qc.invalidateQueries({
        queryKey: ["customers"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-customers"],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // ============================================================
  // REGISTRAR ABONO
  //
  // IMPORTANTE:
  // Ya NO hacemos:
  //
  // supabase.from("credit_payments").insert(...)
  //
  // Todo pasa por register_credit_payment().
  // ============================================================

  const registerPayment = useMutation({
    mutationFn: async () => {
      if (!payCustomerId) {
        throw new Error("Selecciona un cliente");
      }

      const amount = Number(payAmount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          "El monto debe ser mayor a cero",
        );
      }

      if (
        !["cash", "card", "transfer"].includes(
          payMethod,
        )
      ) {
        throw new Error(
          "Método de pago inválido",
        );
      }

      const { data, error } =
        await (supabase as any).rpc(
          "register_credit_payment",
          {
            _customer_id: payCustomerId,
            _amount: amount,
            _payment_method: payMethod,
            _branch_id: branchId ?? null,
            _cash_session_id: null,
            _notes:
              payNotes.trim() || null,
          },
        );

      if (error) {
        throw error;
      }

      return data;
    },

    onSuccess: () => {
      toast.success("Abono registrado correctamente");

      setPayCustomerId(null);
      setPayAmount("");
      setPayMethod("cash");
      setPayNotes("");

      void qc.invalidateQueries({
        queryKey: ["credit-payments"],
      });

      void qc.invalidateQueries({
        queryKey: ["customer-sales-agg"],
      });

      void qc.invalidateQueries({
        queryKey: ["customers"],
      });

      void qc.invalidateQueries({
        queryKey: ["cash-session"],
      });

      void qc.invalidateQueries({
        queryKey: ["cash-movements"],
      });
    },

    onError: (error: Error) => {
      const message =
        error.message ||
        "No se pudo registrar el abono";

      toast.error(message);
    },
  });

  // ============================================================
  // CLIENTE SELECCIONADO PARA ABONO
  // ============================================================

  const paymentCustomer = useMemo(() => {
    if (!payCustomerId) return null;

    return (
      customers.find(
        (customer) =>
          customer.id === payCustomerId,
      ) ?? null
    );
  }, [customers, payCustomerId]);

  const paymentCustomerBalance =
    payCustomerId
      ? stats.get(payCustomerId)?.credit ?? 0
      : 0;

  // ============================================================
  // UI
  // ============================================================

  return (
    <PageShell>
      <PageHeader
        icon={Users}
        title="Clientes"
        description="Contactos, historial de compras, saldo a crédito y abonos."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ======================================================
            FORMULARIO CLIENTE
        ====================================================== */}

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">
              {form.id
                ? "Editar cliente"
                : "Nuevo cliente"}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <div>
              <Label>Nombre</Label>

              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Teléfono</Label>

              <Input
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Correo</Label>

              <Input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Dirección</Label>

              <Input
                value={form.address}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
                placeholder="Opcional"
              />
            </div>

            <div>
              <Label>Notas</Label>

              <Input
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </div>

            <div className="flex gap-2">
              {form.id && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    setForm(empty)
                  }
                >
                  Cancelar
                </Button>
              )}

              <Button
                className="flex-1"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate()
                }
              >
                {save.isPending
                  ? "Guardando…"
                  : form.id
                    ? "Actualizar"
                    : "Crear"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ======================================================
            LISTADO
        ====================================================== */}

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              Listado
            </CardTitle>

            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />

              <Input
                className="h-8 pl-7"
                placeholder="Buscar…"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </div>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    Nombre
                  </TableHead>

                  <TableHead>
                    Teléfono
                  </TableHead>

                  <TableHead className="text-right">
                    Compras
                  </TableHead>

                  <TableHead className="text-right">
                    Total
                  </TableHead>

                  <TableHead className="text-right">
                    Saldo crédito
                  </TableHead>

                  <TableHead className="text-right">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filtered.map((customer) => {
                  const stat =
                    stats.get(customer.id);

                  const balance =
                    stat?.credit ?? 0;

                  return (
                    <TableRow
                      key={customer.id}
                    >
                      <TableCell className="font-medium">
                        {customer.name}
                      </TableCell>

                      <TableCell className="text-sm">
                        {customer.phone ?? "—"}
                      </TableCell>

                      <TableCell className="text-right">
                        {stat?.count ?? 0}
                      </TableCell>

                      <TableCell className="text-right font-medium">
                        {money(
                          stat?.total ?? 0,
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {balance > 0 ? (
                          <Badge variant="destructive">
                            {money(balance)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            $0
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {/* ABONO */}

                          {balance > 0 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Registrar abono"
                              onClick={() => {
                                setPayCustomerId(
                                  customer.id,
                                );

                                setPayAmount(
                                  balance.toFixed(
                                    2,
                                  ),
                                );

                                setPayMethod(
                                  "cash",
                                );

                                setPayNotes("");
                              }}
                            >
                              <Wallet className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {/* EDITAR */}

                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Editar cliente"
                            onClick={() =>
                              setForm({
                                id: customer.id,
                                name:
                                  customer.name,
                                phone:
                                  customer.phone ??
                                  "",
                                email:
                                  customer.email ??
                                  "",
                                notes:
                                  customer.notes ??
                                  "",
                                address:
                                  customer.address ??
                                  "",
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>

                          {/* ELIMINAR */}

                          {isManager && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              title="Eliminar cliente"
                              onClick={() =>
                                remove.mutate(
                                  customer.id,
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!isLoading &&
                  filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        Sin clientes.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ========================================================
          DIALOG ABONO
      ======================================================== */}

      <Dialog
        open={!!payCustomerId}
        onOpenChange={(open) => {
          if (!open) {
            setPayCustomerId(null);
            setPayAmount("");
            setPayMethod("cash");
            setPayNotes("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Registrar abono
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* CLIENTE */}

            {paymentCustomer && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-medium">
                  {paymentCustomer.name}
                </div>

                {paymentCustomer.phone && (
                  <div className="text-xs text-muted-foreground">
                    {paymentCustomer.phone}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Saldo pendiente
                  </span>

                  <span className="font-semibold">
                    {money(
                      paymentCustomerBalance,
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* MONTO */}

            <div>
              <Label>Monto</Label>

              <Input
                type="number"
                min="0.01"
                max={
                  paymentCustomerBalance > 0
                    ? paymentCustomerBalance
                    : undefined
                }
                step="0.01"
                value={payAmount}
                onChange={(event) =>
                  setPayAmount(
                    event.target.value,
                  )
                }
              />

              <p className="mt-1 text-xs text-muted-foreground">
                Máximo permitido:{" "}
                {money(
                  paymentCustomerBalance,
                )}
              </p>
            </div>

            {/* MÉTODO */}

            <div>
              <Label>
                Método de pago
              </Label>

              <Select
                value={payMethod}
                onValueChange={
                  setPayMethod
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="cash">
                    Efectivo
                  </SelectItem>

                  <SelectItem value="card">
                    Tarjeta
                  </SelectItem>

                  <SelectItem value="transfer">
                    Transferencia
                  </SelectItem>
                </SelectContent>
              </Select>

              {payMethod === "cash" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  El sistema buscará automáticamente
                  la caja abierta y registrará el
                  efectivo como entrada.
                </p>
              )}
            </div>

            {/* NOTAS */}

            <div>
              <Label>Notas</Label>

              <Input
                value={payNotes}
                onChange={(event) =>
                  setPayNotes(
                    event.target.value,
                  )
                }
                placeholder="Opcional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPayCustomerId(null);
                setPayAmount("");
                setPayMethod("cash");
                setPayNotes("");
              }}
            >
              Cancelar
            </Button>

            <Button
              disabled={
                registerPayment.isPending ||
                !payCustomerId ||
                Number(payAmount) <= 0 ||
                Number(payAmount) >
                  paymentCustomerBalance
              }
              onClick={() =>
                registerPayment.mutate()
              }
            >
              {registerPayment.isPending
                ? "Registrando…"
                : "Abonar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}