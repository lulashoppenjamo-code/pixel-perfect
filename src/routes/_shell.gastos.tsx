import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Pencil,
  Plus,
  Receipt,
  Trash2,
  X,
} from "lucide-react";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_shell/gastos")({
  head: () => ({
    meta: [
      { title: "Gastos — Lula Shop OS" },
      {
        name: "description",
        content:
          "Registro y control de gastos por sucursal, integrado con caja y reportes.",
      },
    ],
  }),
  component: () => (
    <RequireNavAccess navKey="gastos">
      <GastosPage />
    </RequireNavAccess>
  ),
});

const CATEGORIES = [
  "Renta",
  "Servicios",
  "Nómina",
  "Transporte",
  "Mantenimiento",
  "Marketing",
  "Impuestos",
  "Papelería",
  "Compras menores",
  "Otros",
];

const PAYMENT_METHODS = [
  {
    value: "cash",
    label: "Efectivo",
  },
  {
    value: "card",
    label: "Tarjeta",
  },
  {
    value: "transfer",
    label: "Transferencia",
  },
];

type ExpenseForm = {
  concept: string;
  category: string;
  amount: string;
  expense_date: string;
  payment_method: string;
  notes: string;
};

type ExpenseRow = {
  id: string;
  concept: string;
  category: string | null;
  amount: number;
  expense_date: string;
  payment_method: string;
  notes: string | null;
  branch_id: string | null;
  cash_session_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type CashSession = {
  id: string;
  branch_id: string;
  status: "open" | "closed";
  opened_at: string;
  opened_by: string;
};

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyForm(): ExpenseForm {
  return {
    concept: "",
    category: "Otros",
    amount: "",
    expense_date: getToday(),
    payment_method: "cash",
    notes: "",
  };
}

function paymentMethodLabel(method: string) {
  switch (method) {
    case "cash":
      return "Efectivo";
    case "card":
      return "Tarjeta";
    case "transfer":
      return "Transferencia";
    default:
      return method;
  }
}

function isMissingTableError(error: {
  code?: string;
  message?: string;
}) {
  return (
    error.code === "42P01" ||
    error.message?.toLowerCase().includes("does not exist") === true
  );
}

function GastosPage() {
  const { user, isManager, can } = useAuth();
  const canCreateExpense = can("gastos.create");
  const canEditExpense = can("gastos.edit");
  const canDeleteExpense = can("gastos.delete");
  const { branchId } = useBranch();
  const qc = useQueryClient();

  const [form, setForm] = useState<ExpenseForm>(
    createEmptyForm(),
  );

  const [editingId, setEditingId] = useState<string | null>(
    null,
  );

  const [tableMissing, setTableMissing] = useState(false);

  const [filterCategory, setFilterCategory] =
    useState("all");

  const [filterPayment, setFilterPayment] =
    useState("all");

  const [filterFrom, setFilterFrom] =
    useState("");

  const [filterTo, setFilterTo] =
    useState("");

  const { data: expenses = [], isLoading } =
    useQuery<ExpenseRow[]>({
      queryKey: ["expenses", branchId],
      enabled: !!branchId,
      queryFn: async () => {
        const { data, error } = await supabase
          .from("expenses")
          .select(
            `
              id,
              concept,
              category,
              amount,
              expense_date,
              payment_method,
              notes,
              branch_id,
              cash_session_id,
              created_by,
              created_at,
              updated_at
            `,
          )
          .eq("branch_id", branchId!)
          .order("expense_date", {
            ascending: false,
          })
          .order("created_at", {
            ascending: false,
          })
          .limit(200);

        if (error) {
          if (isMissingTableError(error)) {
            setTableMissing(true);
            return [];
          }

          throw error;
        }

        setTableMissing(false);

        return (data ?? []) as ExpenseRow[];
      },
    });

  const {
    data: openCashSession = null,
    isLoading: loadingCashSession,
  } = useQuery<CashSession | null>({
    queryKey: ["open-cash-session-for-expenses", branchId],
    enabled:
      !!branchId &&
      form.payment_method === "cash",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select(
          "id, branch_id, status, opened_at, opened_by",
        )
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .maybeSingle();

      if (error) throw error;

      return data as CashSession | null;
    },
  });

  const filteredExpenses = useMemo(() => {
    return expenses.filter((expense) => {
      if (
        filterCategory !== "all" &&
        expense.category !== filterCategory
      ) {
        return false;
      }

      if (
        filterPayment !== "all" &&
        expense.payment_method !== filterPayment
      ) {
        return false;
      }

      if (
        filterFrom &&
        expense.expense_date < filterFrom
      ) {
        return false;
      }

      if (
        filterTo &&
        expense.expense_date > filterTo
      ) {
        return false;
      }

      return true;
    });
  }, [
    expenses,
    filterCategory,
    filterPayment,
    filterFrom,
    filterTo,
  ]);

  const totalFiltered = useMemo(
    () =>
      filteredExpenses.reduce(
        (total, expense) =>
          total + Number(expense.amount ?? 0),
        0,
      ),
    [filteredExpenses],
  );

  const totalCash = useMemo(
    () =>
      filteredExpenses
        .filter(
          (expense) =>
            expense.payment_method === "cash",
        )
        .reduce(
          (total, expense) =>
            total + Number(expense.amount ?? 0),
          0,
        ),
    [filteredExpenses],
  );

  const totalCard = useMemo(
    () =>
      filteredExpenses
        .filter(
          (expense) =>
            expense.payment_method === "card",
        )
        .reduce(
          (total, expense) =>
            total + Number(expense.amount ?? 0),
          0,
        ),
    [filteredExpenses],
  );

  const totalTransfer = useMemo(
    () =>
      filteredExpenses
        .filter(
          (expense) =>
            expense.payment_method === "transfer",
        )
        .reduce(
          (total, expense) =>
            total + Number(expense.amount ?? 0),
          0,
        ),
    [filteredExpenses],
  );

  const resetForm = () => {
    setForm(createEmptyForm());
    setEditingId(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error("No hay una sucursal activa");
      }

      if (!user?.id) {
        throw new Error("Sesión no válida");
      }

      const concept = form.concept.trim();

      if (!concept) {
        throw new Error("Escribe el concepto del gasto");
      }

      const amount = Number(form.amount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          "El monto debe ser mayor a cero",
        );
      }

      if (!form.expense_date) {
        throw new Error(
          "Selecciona la fecha del gasto",
        );
      }

      if (
        form.payment_method === "cash" &&
        !openCashSession &&
        !editingId
      ) {
        throw new Error(
          "Para registrar un gasto en efectivo debes tener una caja abierta en esta sucursal",
        );
      }

      const payload = {
        concept,
        category: form.category,
        amount,
        expense_date: form.expense_date,
        payment_method: form.payment_method,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("expenses")
          .update(payload)
          .eq("id", editingId)
          .eq("branch_id", branchId);

        if (error) throw error;

        return;
      }

      const { error } = await supabase
        .from("expenses")
        .insert({
          ...payload,
          branch_id: branchId,
          cash_session_id:
            form.payment_method === "cash"
              ? openCashSession?.id ?? null
              : null,
          created_by: user.id,
        });

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        editingId
          ? "Gasto actualizado"
          : "Gasto registrado",
      );

      resetForm();

      void qc.invalidateQueries({
        queryKey: ["expenses"],
      });

      void qc.invalidateQueries({
        queryKey: ["open-cash-session-for-expenses"],
      });

      void qc.invalidateQueries({
        queryKey: ["cash-session"],
      });

      void qc.invalidateQueries({
        queryKey: ["cash-movements"],
      });

      void qc.invalidateQueries({
        queryKey: ["reports"],
      });

      void qc.invalidateQueries({
        queryKey: ["ceo"],
      });
    },

    onError: (error) => {
      if (
        isMissingTableError(error)
      ) {
        toast.error(
          "La tabla expenses no existe en Supabase. Ejecuta las migraciones del proyecto.",
        );
        return;
      }

      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el gasto",
      );
    },
  });

  const remove = useMutation({
    mutationFn: async (expenseId: string) => {
      if (!canDeleteExpense) {
        throw new Error(
          "No tienes permiso para eliminar gastos",
        );
      }

      const { error } = await supabase
        .from("expenses")
        .delete()
        .eq("id", expenseId)
        .eq("branch_id", branchId!);

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Gasto eliminado");

      if (editingId) {
        resetForm();
      }

      void qc.invalidateQueries({
        queryKey: ["expenses"],
      });

      void qc.invalidateQueries({
        queryKey: ["cash-session"],
      });

      void qc.invalidateQueries({
        queryKey: ["cash-movements"],
      });

      void qc.invalidateQueries({
        queryKey: ["reports"],
      });

      void qc.invalidateQueries({
        queryKey: ["ceo"],
      });
    },

    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar el gasto",
      );
    },
  });

  const startEdit = (expense: ExpenseRow) => {
    if (!isManager) {
      toast.error(
        "Solo un gerente puede editar gastos",
      );
      return;
    }

    setEditingId(expense.id);

    setForm({
      concept: expense.concept,
      category: expense.category ?? "Otros",
      amount: String(expense.amount),
      expense_date: expense.expense_date,
      payment_method:
        expense.payment_method,
      notes: expense.notes ?? "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleSubmit = () => {
    save.mutate();
  };

  return (
    <PageShell>
      <PageHeader
        icon={Receipt}
        title="Gastos"
        description="Control de egresos por sucursal, integrado con caja y reportes."
        action={
          editingId ? (
            <Button
              variant="outline"
              onClick={resetForm}
            >
              <X className="mr-2 size-4" />
              Cancelar edición
            </Button>
          ) : undefined
        }
      />

      {tableMissing && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-4 text-sm">
            La tabla{" "}
            <code>expenses</code> no está disponible en
            Supabase. Ejecuta las migraciones del
            proyecto antes de utilizar este módulo.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-4">
        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3.5 sm:pt-6 sm:p-6">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#757575] sm:text-sm sm:normal-case sm:tracking-normal">
              Total filtrado
            </p>
            <p className="mt-1 text-xl font-bold text-[#c62828] sm:text-2xl">
              {money(totalFiltered)}
            </p>
            <p className="mt-0.5 text-[11px] text-[#9e9e9e]">
              {filteredExpenses.length} gasto
              {filteredExpenses.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3.5 sm:pt-6 sm:p-6">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#757575] sm:text-sm sm:normal-case sm:tracking-normal">
              Efectivo
            </p>
            <p className="mt-1 text-xl font-bold text-[#212121] sm:text-2xl">
              {money(totalCash)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3.5 sm:pt-6 sm:p-6">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#757575] sm:text-sm sm:normal-case sm:tracking-normal">
              Tarjeta + transfer.
            </p>
            <p className="mt-1 text-xl font-bold text-[#212121] sm:text-2xl">
              {money(
                totalCard + totalTransfer,
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid max-w-full gap-6 overflow-x-hidden lg:grid-cols-[360px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">
              {editingId
                ? "Editar gasto"
                : "Nuevo gasto"}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Concepto</Label>

              <Input
                value={form.concept}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    concept:
                      event.target.value,
                  }))
                }
                placeholder="Ej. Luz del local"
                className="h-11"
                disabled={
                  save.isPending ||
                  tableMissing
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>

              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    category: value,
                  }))
                }
                disabled={
                  save.isPending ||
                  tableMissing
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {CATEGORIES.map(
                    (category) => (
                      <SelectItem
                        key={category}
                        value={category}
                      >
                        {category}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Monto</Label>

              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    amount:
                      event.target.value,
                  }))
                }
                placeholder="0.00"
                className="h-11"
                disabled={
                  save.isPending ||
                  tableMissing
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Fecha</Label>

              <Input
                type="date"
                value={form.expense_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    expense_date:
                      event.target.value,
                  }))
                }
                disabled={
                  save.isPending ||
                  tableMissing
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Método de pago</Label>

              <Select
                value={form.payment_method}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    payment_method: value,
                  }))
                }
                disabled={
                  save.isPending ||
                  tableMissing
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {PAYMENT_METHODS.map(
                    (method) => (
                      <SelectItem
                        key={method.value}
                        value={method.value}
                      >
                        {method.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {form.payment_method ===
              "cash" && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  openCashSession
                    ? "border-green-500/40 bg-green-500/5"
                    : "border-amber-500/40 bg-amber-500/5"
                }`}
              >
                {loadingCashSession ? (
                  "Verificando caja..."
                ) : openCashSession ? (
                  <>
                    <p className="font-medium">
                      Caja abierta
                    </p>

                    <p className="mt-1 text-muted-foreground">
                      Este gasto quedará ligado a la
                      sesión de caja actual.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      No hay caja abierta
                    </p>

                    <p className="mt-1 text-muted-foreground">
                      Abre la caja de esta sucursal
                      para registrar un gasto en
                      efectivo.
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Nota</Label>

              <Input
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes:
                      event.target.value,
                  }))
                }
                placeholder="Nota opcional"
                disabled={
                  save.isPending ||
                  tableMissing
                }
              />
            </div>

            <div className="flex gap-2">
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={save.isPending}
                  onClick={resetForm}
                >
                  Cancelar
                </Button>
              )}

              <Button
                className="h-11 flex-1 gap-2 rounded-xl bg-[#43a047] text-[15px] font-semibold text-white hover:bg-[#388e3c]"
                disabled={
                  save.isPending ||
                  tableMissing ||
                  !branchId ||
                  !form.concept.trim() ||
                  !form.amount ||
                  (form.payment_method ===
                    "cash" &&
                    !openCashSession &&
                    !editingId) ||
                  (editingId ? !canEditExpense : !canCreateExpense)
                }
                onClick={handleSubmit}
              >
                {editingId ? (
                  <Pencil className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}

                {save.isPending
                  ? "Guardando..."
                  : editingId
                    ? "Guardar cambios"
                    : "Registrar gasto"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">
                Historial de gastos
              </CardTitle>

              <span className="text-sm font-semibold text-destructive">
                {money(totalFiltered)}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-xs">
                  Categoría
                </Label>

                <Select
                  value={filterCategory}
                  onValueChange={
                    setFilterCategory
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="all">
                      Todas
                    </SelectItem>

                    {CATEGORIES.map(
                      (category) => (
                        <SelectItem
                          key={category}
                          value={category}
                        >
                          {category}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  Método
                </Label>

                <Select
                  value={filterPayment}
                  onValueChange={
                    setFilterPayment
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="all">
                      Todos
                    </SelectItem>

                    {PAYMENT_METHODS.map(
                      (method) => (
                        <SelectItem
                          key={method.value}
                          value={method.value}
                        >
                          {method.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  Desde
                </Label>

                <Input
                  type="date"
                  value={filterFrom}
                  onChange={(event) =>
                    setFilterFrom(
                      event.target.value,
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  Hasta
                </Label>

                <Input
                  type="date"
                  value={filterTo}
                  onChange={(event) =>
                    setFilterTo(
                      event.target.value,
                    )
                  }
                />
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setFilterCategory("all");
                    setFilterPayment("all");
                    setFilterFrom("");
                    setFilterTo("");
                  }}
                >
                  Limpiar filtros
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="overflow-x-auto -mx-1 px-1">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Cargando gastos...
              </div>
            ) : (
              <>
              {/* Móvil: tarjetas */}
              <div className="grid gap-2.5 lg:hidden">
                {filteredExpenses.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No hay gastos en este filtro.
                  </div>
                ) : (
                  filteredExpenses.map((expense) => (
                    <div
                      key={expense.id}
                      className="rounded-xl border border-[#e0e0e0] bg-white p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-[15px] font-bold text-[#212121]">
                            {expense.concept}
                          </p>
                          <p className="mt-0.5 text-xs text-[#757575]">
                            {shortDate(expense.expense_date)}
                            {" · "}
                            {expense.category ?? "Sin categoría"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#9e9e9e]">
                            {paymentMethodLabel(
                              expense.payment_method,
                            )}
                            {expense.payment_method ===
                              "cash" &&
                            expense.cash_session_id
                              ? " · Ligado a caja"
                              : ""}
                          </p>
                        </div>
                        <p className="shrink-0 text-base font-bold text-[#c62828]">
                          {money(Number(expense.amount))}
                        </p>
                      </div>
                      <div className="mt-3 flex gap-1.5 border-t border-[#eeeeee] pt-2.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 flex-1 rounded-lg"
                          onClick={() => {
                            setEditingId(expense.id);
                            setForm({
                              concept: expense.concept,
                              category:
                                expense.category ??
                                CATEGORIES[0],
                              amount: String(
                                expense.amount,
                              ),
                              expense_date:
                                expense.expense_date,
                              payment_method:
                                expense.payment_method ??
                                "cash",
                              notes: expense.notes ?? "",
                            });
                          }}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Editar
                        </Button>
                        {isManager ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 rounded-lg text-destructive"
                            disabled={remove.isPending}
                            onClick={() =>
                              remove.mutate(expense.id)
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop: tabla */}
              <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Fecha
                    </TableHead>

                    <TableHead>
                      Concepto
                    </TableHead>

                    <TableHead>
                      Categoría
                    </TableHead>

                    <TableHead>
                      Método
                    </TableHead>

                    <TableHead className="text-right">
                      Monto
                    </TableHead>

                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredExpenses.map(
                    (expense) => (
                      <TableRow
                        key={expense.id}
                      >
                        <TableCell className="whitespace-nowrap">
                          {shortDate(
                            expense.expense_date,
                          )}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {expense.concept}
                            </p>

                            {expense.notes && (
                              <p className="max-w-[260px] truncate text-xs text-muted-foreground">
                                {expense.notes}
                              </p>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          {expense.category ??
                            "—"}
                        </TableCell>

                        <TableCell>
                          {paymentMethodLabel(
                            expense.payment_method,
                          )}

                          {expense.payment_method ===
                            "cash" &&
                            expense.cash_session_id && (
                              <p className="text-[11px] text-muted-foreground">
                                Ligado a caja
                              </p>
                            )}
                        </TableCell>

                        <TableCell className="text-right font-semibold">
                          {money(
                            Number(
                              expense.amount,
                            ),
                          )}
                        </TableCell>

                        <TableCell>
                          {isManager && (
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  startEdit(
                                    expense,
                                  )
                                }
                                title="Editar gasto"
                              >
                                <Pencil className="size-4" />
                              </Button>

                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                disabled={
                                  remove.isPending
                                }
                                onClick={() => {
                                  const confirmed =
                                    window.confirm(
                                      `¿Eliminar el gasto "${expense.concept}" por ${money(
                                        Number(
                                          expense.amount,
                                        ),
                                      )}?`,
                                    );

                                  if (
                                    confirmed
                                  ) {
                                    remove.mutate(
                                      expense.id,
                                    );
                                  }
                                }}
                                title="Eliminar gasto"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ),
                  )}

                  {!filteredExpenses.length && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No hay gastos que coincidan
                        con los filtros.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
              </>

            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}