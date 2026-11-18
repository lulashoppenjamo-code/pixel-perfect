/**
 * Clientes — LULA OS
 *
 * CRUD de clientes
 * Historial de compras
 * Historial de crédito
 * Saldo pendiente
 * Abonos
 *
 * Los abonos pasan exclusivamente por:
 * register_credit_payment()
 *
 * BLOQUE 8 — Visual Clientes.
 * Solo presentación. Sin tocar abonos, crédito ni CRUD lógico.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Pencil,
  Trash2,
  Search,
  Wallet,
  Users,
  History,
  CreditCard,
  UserCheck,
  AlertCircle,
  ShoppingBag,
  QrCode,
  RefreshCw,
  ScanBarcode,
} from "lucide-react";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { toast } from "sonner";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { CreditHistoryDialog } from "@/components/customers/CreditHistoryDialog";

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

export const Route = createFileRoute(
  "/_shell/clientes",
)({
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
  barcode: string;
  whatsapp: string;
  school: string;
  school_id: string;
  discount_type: string;
  start_date: string;
  end_date: string;
  active: boolean;
};

const empty: Form = {
  name: "",
  phone: "",
  email: "",
  notes: "",
  address: "",
  barcode: "",
  whatsapp: "",
  school: "",
  school_id: "",
  discount_type: "",
  start_date: "",
  end_date: "",
  active: true,
};

type SchoolForm = {
  id?: string;
  name: string;
  contact_name: string;
  phone: string;
  discount_type: string;
  start_date: string;
  end_date: string;
  notes: string;
  active: boolean;
};

const emptySchool: SchoolForm = {
  name: "",
  contact_name: "",
  phone: "",
  discount_type: "",
  start_date: "",
  end_date: "",
  notes: "",
  active: true,
};

function genCustomerCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function customerCardCode(c: CustomerRow): string {
  return String(c.barcode || c.code || "").trim();
}

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  address?: string | null;
  barcode?: string | null;
  code?: string | null;
  whatsapp?: string | null;
  school?: string | null;
  school_id?: string | null;
  discount_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  active?: boolean | null;
};

type SchoolRow = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  discount_type: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  active: boolean;
};

type ConvenioStatus = "activo" | "por_vencer" | "vencido" | "sin_fecha";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function convenioStatusOf(c: {
  end_date?: string | null;
  active?: boolean | null;
}): ConvenioStatus {
  if (c.active === false) return "vencido";
  if (!c.end_date) return "sin_fecha";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${c.end_date}T00:00:00`);
  const diff = Math.floor(
    (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff < 0) return "vencido";
  if (diff <= 15) return "por_vencer";
  return "activo";
}

function benefitIsActive(c: {
  active?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
}) {
  const today = todayString();
  if (c.active === false) return false;
  if (c.start_date && c.start_date > today) return false;
  if (c.end_date && c.end_date < today) return false;
  return true;
}

const CONVENIO_META: Record<
  ConvenioStatus,
  { label: string; badge: string }
> = {
  activo: {
    label: "Convenio activo",
    badge: "bg-emerald-100 text-emerald-800",
  },
  por_vencer: {
    label: "Por vencer",
    badge: "bg-amber-100 text-amber-800",
  },
  vencido: {
    label: "Vencido",
    badge: "bg-red-100 text-red-800",
  },
  sin_fecha: {
    label: "Sin vigencia",
    badge: "bg-slate-100 text-slate-700",
  },
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

type CustomerStats = {
  count: number;
  total: number;
  credit: number;
  last: string | null;
};

function ClientesPage() {
  const { isManager, can } = useAuth();
  const canCreditPay = can("clientes.credit_payment");
  const { branchId } = useBranch();
  const qc = useQueryClient();

  const [form, setForm] = useState<Form>(empty);
  const [search, setSearch] = useState("");
  /** Filtro visual de saldo (client-side sobre stats ya calculados). */
  const [debtFilter, setDebtFilter] = useState<"all" | "debt" | "clear">("all");

  const [section, setSection] = useState<"clientes" | "escuelas">("clientes");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ConvenioStatus>("all");
  const [schoolForm, setSchoolForm] = useState<SchoolForm>(emptySchool);
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);

  const [scanHighlightId, setScanHighlightId] = useState<string | null>(null);
  const scannerBufferRef = useRef("");
  const scannerTimerRef = useRef<number | null>(null);
  const lastScannerKeyTimeRef = useRef(0);
  const scannerBusyRef = useRef(false);
  const customersRef = useRef<CustomerRow[]>([]);

  const [payCustomerId, setPayCustomerId] =
    useState<string | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] =
    useState("cash");
  const [payNotes, setPayNotes] = useState("");

  const [historyCustomerId, setHistoryCustomerId] =
    useState<string | null>(null);

  const {
    data: customers = [],
    isLoading,
    isError: customersError,
  } = useQuery<CustomerRow[]>({
    queryKey: ["customers"],
    staleTime: 30_000,

    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");

      if (error) {
        throw error;
      }

      return (data ?? []) as CustomerRow[];
    },
  });

  customersRef.current = customers;

  const {
    data: schools = [],
    isLoading: schoolsLoading,
  } = useQuery<SchoolRow[]>({
    queryKey: ["schools"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("schools")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as SchoolRow[];
    },
  });

  const {
    data: salesByCustomer = [],
    isError: salesError,
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

      if (error) {
        throw error;
      }

      return (data ?? []) as SaleCustomerRow[];
    },
  });

  const {
    data: creditPayments = [],
    isError: paymentsError,
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

  const stats = useMemo(() => {
    const map = new Map<string, CustomerStats>();

    for (const sale of salesByCustomer) {
      if (!sale.customer_id) {
        continue;
      }

      const current =
        map.get(sale.customer_id) ?? {
          count: 0,
          total: 0,
          credit: 0,
          last: null,
        };

      current.count += 1;

      current.total += Number(
        sale.total ?? 0,
      );

      if (sale.payment_method === "credit") {
        current.credit += Number(
          sale.total ?? 0,
        );
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

    for (const [
      customerId,
      current,
    ] of map) {
      current.credit = Math.max(
        0,
        current.credit -
          (paid.get(customerId) ?? 0),
      );
    }

    return map;
  }, [salesByCustomer, creditPayments]);

  const dashboard = useMemo(() => {
    let totalPurchases = 0;
    let totalCredit = 0;
    let customersWithPurchases = 0;
    let customersWithDebt = 0;

    for (const customer of customers) {
      const stat = stats.get(customer.id);

      if (!stat) {
        continue;
      }

      totalPurchases += stat.total;

      if (stat.count > 0) {
        customersWithPurchases += 1;
      }

      if (stat.credit > 0) {
        customersWithDebt += 1;
        totalCredit += stat.credit;
      }
    }

    return {
      totalCustomers: customers.length,
      customersWithPurchases,
      customersWithDebt,
      totalPurchases,
      totalCredit,
    };
  }, [customers, stats]);

  const filtered = customers.filter((customer) => {
    if (schoolFilter !== "all") {
      const byId = customer.school_id === schoolFilter;
      const schoolName =
        schools.find((s) => s.id === schoolFilter)?.name ?? "";
      const byName =
        !!schoolName &&
        (customer.school ?? "").trim() === schoolName.trim();
      if (customer.school_id) {
        if (!byId) return false;
      } else if (!byName) {
        return false;
      }
    }

    if (statusFilter !== "all") {
      if (convenioStatusOf(customer) !== statusFilter) return false;
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const qDigits = q.replace(/\D/g, "");
      const card = customerCardCode(customer).toLowerCase();
      const cardDigits = card.replace(/\D/g, "");
      const phoneDigits = (customer.phone ?? "").replace(/\D/g, "");
      const match =
        customer.name.toLowerCase().includes(q) ||
        (customer.phone ?? "").toLowerCase().includes(q) ||
        (customer.whatsapp ?? "").toLowerCase().includes(q) ||
        (customer.email ?? "").toLowerCase().includes(q) ||
        (customer.notes ?? "").toLowerCase().includes(q) ||
        (customer.address ?? "").toLowerCase().includes(q) ||
        (customer.school ?? "").toLowerCase().includes(q) ||
        (customer.discount_type ?? "").toLowerCase().includes(q) ||
        card.includes(q) ||
        (qDigits.length > 0 &&
          (cardDigits.includes(qDigits) ||
            phoneDigits.includes(qDigits) ||
            cardDigits === qDigits ||
            phoneDigits === qDigits));
      if (!match) return false;
    }

    if (debtFilter === "all") return true;
    const balance = stats.get(customer.id)?.credit ?? 0;
    if (debtFilter === "debt") return balance > 0;
    if (debtFilter === "clear") return balance <= 0;
    return true;
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) {
        throw new Error("Nombre requerido");
      }

      const schoolName = form.school.trim() || null;
      let schoolId: string | null = form.school_id || null;
      if (schoolName) {
        const matched = schools.find(
          (s) => s.name.trim() === schoolName || s.id === form.school_id,
        );
        schoolId = matched ? matched.id : form.school_id || null;
        if (!schoolId && form.school_id) schoolId = form.school_id;
      } else {
        schoolId = null;
      }

      const payload: Record<string, string | boolean | null> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        address: form.address.trim() || null,
        barcode: form.barcode.trim() || genCustomerCode(),
        whatsapp: form.whatsapp.trim() || null,
        school: schoolName,
        school_id: schoolId,
        discount_type: form.discount_type.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        active: form.active,
      };

      if (form.id) {
        const { error } =
          await supabase
            .from("customers")
            .update(payload)
            .eq("id", form.id);

        if (error) {
          throw error;
        }

        return;
      }

      const { error } =
        await supabase
          .from("customers")
          .insert(payload);

      if (error) {
        throw error;
      }
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

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const stat = stats.get(id);

      if (stat && stat.credit > 0) {
        throw new Error(
          "No puedes eliminar un cliente con saldo pendiente.",
        );
      }

      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", id);

      if (error) {
        throw error;
      }
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

  const registerPayment = useMutation({
    mutationFn: async () => {
      if (!payCustomerId) {
        throw new Error(
          "Selecciona un cliente",
        );
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
        ![
          "cash",
          "card",
          "transfer",
        ].includes(payMethod)
      ) {
        throw new Error(
          "Método de pago inválido",
        );
      }

      if (
        amount >
        paymentCustomerBalance + 0.005
      ) {
        throw new Error(
          "El abono no puede superar el saldo pendiente.",
        );
      }

      const { data, error } =
        await (supabase as any).rpc(
          "register_credit_payment",
          {
            _customer_id:
              payCustomerId,
            _amount: Number(
              amount.toFixed(2),
            ),
            _payment_method:
              payMethod,
            _branch_id:
              branchId ?? null,
            _cash_session_id:
              null,
            _notes:
              payNotes.trim() ||
              null,
          },
        );

      if (error) {
        const msg = String(error.message ?? "").toLowerCase();
        if (
          msg.includes("could not find the function") ||
          (msg.includes("register_credit_payment") &&
            msg.includes("schema cache"))
        ) {
          throw new Error(
            "Falta la función de abonos en la base de datos. Ejecuta en Supabase el SQL FIX_register_credit_payment.sql y recarga la app.",
          );
        }
        if (msg.includes("no open cash session")) {
          throw new Error(
            "Para abonar en efectivo debes tener la caja abierta en esta sucursal.",
          );
        }
        if (msg.includes("no outstanding balance")) {
          throw new Error(
            "Este cliente no tiene saldo pendiente.",
          );
        }
        if (msg.includes("exceeds customer balance")) {
          throw new Error(
            "El abono supera el saldo pendiente del cliente.",
          );
        }
        if (msg.includes("not authorized")) {
          throw new Error(
            "No tienes permiso para registrar abonos.",
          );
        }
        throw error;
      }

      return data;
    },

    onSuccess: () => {
      toast.success(
        "Abono registrado correctamente",
      );

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

      void qc.invalidateQueries({
        queryKey: [
          "customer-credit-history",
        ],
      });
    },

    onError: (error: Error) => {
      toast.error(
        error.message ||
          "No se pudo registrar el abono",
      );
    },
  });

  const paymentCustomer = useMemo(() => {
    if (!payCustomerId) {
      return null;
    }

    return (
      customers.find(
        (customer) =>
          customer.id ===
          payCustomerId,
      ) ?? null
    );
  }, [customers, payCustomerId]);

  const paymentCustomerBalance =
    payCustomerId
      ? stats.get(payCustomerId)
          ?.credit ?? 0
      : 0;

  const historyCustomer = useMemo(
    () =>
      customers.find(
        (customer) =>
          customer.id ===
          historyCustomerId,
      ) ?? null,
    [customers, historyCustomerId],
  );

  const historyBalance =
    historyCustomerId
      ? stats.get(historyCustomerId)
          ?.credit ?? 0
      : 0;

  const saveSchool = useMutation({
    mutationFn: async () => {
      if (!schoolForm.name.trim()) {
        throw new Error("El nombre de la escuela es obligatorio");
      }
      const payload = {
        name: schoolForm.name.trim(),
        contact_name: schoolForm.contact_name.trim() || null,
        phone: schoolForm.phone.trim() || null,
        discount_type: schoolForm.discount_type.trim() || null,
        start_date: schoolForm.start_date || null,
        end_date: schoolForm.end_date || null,
        notes: schoolForm.notes.trim() || null,
        active: schoolForm.active,
      };
      if (schoolForm.id) {
        const { error } = await (supabase as any)
          .from("schools")
          .update(payload)
          .eq("id", schoolForm.id);
        if (error) throw error;

        const old = schools.find((s) => s.id === schoolForm.id);
        if (old && old.name.trim() !== schoolForm.name.trim()) {
          await supabase
            .from("customers")
            .update({ school: schoolForm.name.trim() } as any)
            .eq("school_id", schoolForm.id);
        }
      } else {
        const { error } = await (supabase as any)
          .from("schools")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        schoolForm.id ? "Escuela actualizada" : "Escuela creada",
      );
      setSchoolDialogOpen(false);
      setSchoolForm(emptySchool);
      void qc.invalidateQueries({ queryKey: ["schools"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeSchool = useMutation({
    mutationFn: async (id: string) => {
      const linked = customers.filter((c) => c.school_id === id).length;
      if (linked > 0) {
        throw new Error(
          `Hay ${linked} cliente(s) en esta escuela. Reasígnarlos antes de eliminar.`,
        );
      }
      const { error } = await (supabase as any)
        .from("schools")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Escuela eliminada");
      void qc.invalidateQueries({ queryKey: ["schools"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hasDataError =
    customersError ||
    salesError ||
    paymentsError;

  const findCustomerByCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) {
      toast.error("Escribe o escanea un código");
      return;
    }
    if (scannerBusyRef.current) return;
    scannerBusyRef.current = true;
    try {
      const digits = code.replace(/\D/g, "");
      const lower = code.toLowerCase();
      const match = customersRef.current.find((c) => {
        const card = customerCardCode(c);
        const cardDigits = card.replace(/\D/g, "");
        const phoneDigits = (c.phone ?? "").replace(/\D/g, "");
        return (
          (card &&
            (card === code ||
              card.toLowerCase() === lower ||
              cardDigits === digits)) ||
          (phoneDigits && digits && phoneDigits === digits) ||
          (c.name ?? "").toLowerCase() === lower
        );
      });

      if (!match) {
        toast.error(`No encontré un cliente con el código ${code}`);
        return;
      }

      setSearch(customerCardCode(match) || match.name);
      setScanHighlightId(match.id);
      setDebtFilter("all");
      toast.success(`Cliente: ${match.name}`);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(80);
      }
      window.setTimeout(() => setScanHighlightId(null), 4000);
    } finally {
      scannerBusyRef.current = false;
    }
  };

  // Pistola HID (teclado): escanea sin enfocar un input
  useEffect(() => {
    const clearScannerBuffer = () => {
      scannerBufferRef.current = "";
      lastScannerKeyTimeRef.current = 0;
      if (scannerTimerRef.current !== null) {
        window.clearTimeout(scannerTimerRef.current);
        scannerTimerRef.current = null;
      }
    };

    const handleHardwareScanner = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable;
      if (isEditable) return;

      const now = performance.now();
      const previous = lastScannerKeyTimeRef.current;
      const gap = previous ? now - previous : 0;

      if (event.key === "Enter") {
        const code = scannerBufferRef.current.trim();
        clearScannerBuffer();
        if (code.length >= 3) {
          event.preventDefault();
          findCustomerByCode(code);
        }
        return;
      }

      if (event.key.length !== 1) return;

      if (gap > 120) {
        scannerBufferRef.current = "";
      }

      scannerBufferRef.current += event.key;
      lastScannerKeyTimeRef.current = now;

      if (scannerTimerRef.current !== null) {
        window.clearTimeout(scannerTimerRef.current);
      }

      scannerTimerRef.current = window.setTimeout(() => {
        const code = scannerBufferRef.current.trim();
        clearScannerBuffer();
        if (code.length >= 3) {
          findCustomerByCode(code);
        }
      }, 180);
    };

    window.addEventListener("keydown", handleHardwareScanner, true);
    return () => {
      window.removeEventListener("keydown", handleHardwareScanner, true);
      clearScannerBuffer();
      scannerBusyRef.current = false;
    };
  }, []);

  return (
    <PageShell>
      <PageHeader
        icon={Users}
        title="Clientes"
        description="Directorio, convenios con escuelas, crédito y abonos."
      />

      {hasDataError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-destructive" />

            <div>
              <p className="font-medium">
                No se pudieron cargar todos los datos.
              </p>

              <p className="text-sm text-muted-foreground">
                Actualiza la página e inténtalo nuevamente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl border border-[#e0e0e0] bg-white p-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setSection("clientes")}
          className={
            "rounded-xl px-3 py-2.5 text-center text-sm font-semibold transition " +
            (section === "clientes"
              ? "bg-[#1a73e8] text-white shadow-sm"
              : "bg-transparent text-[#616161]")
          }
        >
          Clientes
        </button>
        <button
          type="button"
          onClick={() => setSection("escuelas")}
          className={
            "rounded-xl px-3 py-2.5 text-center text-sm font-semibold transition " +
            (section === "escuelas"
              ? "bg-[#1a73e8] text-white shadow-sm"
              : "bg-transparent text-[#616161]")
          }
        >
          Escuelas
        </button>
      </div>

      {section === "clientes" && (
      <>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 xl:grid-cols-4">
        <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575] sm:text-[11px]">
                Clientes
              </p>
              <p className="mt-1 text-xl font-bold text-[#1a73e8] sm:text-2xl">
                {dashboard.totalCustomers}
              </p>
              <p className="text-[10px] text-[#9e9e9e]">registrados</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f0fe]">
              <Users className="h-4 w-4 text-[#1a73e8]" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575] sm:text-[11px]">
                Activos
              </p>
              <p className="mt-1 text-xl font-bold text-[#212121] sm:text-2xl">
                {dashboard.customersWithPurchases}
              </p>
              <p className="text-[10px] text-[#9e9e9e]">con compras</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f5e9]">
              <UserCheck className="h-4 w-4 text-[#2e7d32]" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575] sm:text-[11px]">
                Saldo pendiente
              </p>
              <p className="mt-1 text-xl font-bold text-[#c62828] sm:text-2xl">
                {money(dashboard.totalCredit)}
              </p>
              <p className="text-[10px] text-[#9e9e9e]">
                {dashboard.customersWithDebt} con deuda
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fce4ec]">
              <CreditCard className="h-4 w-4 text-[#c62828]" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575] sm:text-[11px]">
                Compras acum.
              </p>
              <p className="mt-1 text-xl font-bold text-[#212121] sm:text-2xl">
                {money(dashboard.totalPurchases)}
              </p>
              <p className="text-[10px] text-[#9e9e9e]">total histórico</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f0fe]">
              <ShoppingBag className="h-4 w-4 text-[#1a73e8]" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid max-w-full gap-4 overflow-x-hidden lg:grid-cols-3">
        <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm lg:col-span-1">
          <CardHeader className="border-b border-[#f0f0f0] pb-3">
            <CardTitle className="text-base font-bold text-[#212121]">
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
                placeholder="Nombre del cliente"
                className="h-11"
              />
            </div>

            <div>
              <Label>Teléfono</Label>

              <Input
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone:
                      event.target.value,
                  }))
                }
                placeholder="Opcional"
                className="h-11"
              />
            </div>

            <div>
              <Label className="flex items-center gap-1.5">
                <QrCode className="h-3.5 w-3.5 text-[#1a73e8]" />
                Código de tarjeta
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={form.barcode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      barcode: event.target.value,
                    }))
                  }
                  placeholder="Se genera solo si lo dejas vacío"
                  className="h-11 font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 px-3"
                  title="Generar código nuevo"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      barcode: genCustomerCode(),
                    }))
                  }
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Imprímelo en la tarjeta del cliente. En Caja o aquí, al
                escanearlo se vincula la venta / ficha.
              </p>
            </div>

            <div>
              <Label>WhatsApp</Label>
              <Input
                className="h-11"
                value={form.whatsapp}
                onChange={(e) =>
                  setForm((c) => ({ ...c, whatsapp: e.target.value }))
                }
                placeholder="Opcional"
              />
            </div>

            <div>
              <Label>Escuela / convenio</Label>
              <select
                className="mt-1 flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.school_id || ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const sch = schools.find((s) => s.id === id);
                  setForm((c) => ({
                    ...c,
                    school_id: id,
                    school: sch?.name ?? "",
                    discount_type:
                      c.discount_type || sch?.discount_type || "",
                  }));
                }}
              >
                <option value="">Sin escuela</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Beneficio / descuento</Label>
              <Input
                className="h-11"
                value={form.discount_type}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    discount_type: e.target.value,
                  }))
                }
                placeholder="Ej. 10%, precio especial..."
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Inicio vigencia</Label>
                <Input
                  type="date"
                  className="h-11"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      start_date: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Fin vigencia</Label>
                <Input
                  type="date"
                  className="h-11"
                  value={form.end_date}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      end_date: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((c) => ({ ...c, active: e.target.checked }))
                }
              />
              Beneficio activo
            </label>

            <div>
              <Label>Correo</Label>

              <Input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email:
                      event.target.value,
                  }))
                }
                placeholder="Opcional"
                className="h-11"
              />
            </div>

            <div>
              <Label>Dirección</Label>

              <Input
                value={form.address}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    address:
                      event.target.value,
                  }))
                }
                placeholder="Opcional"
                className="h-11"
              />
            </div>

            <div>
              <Label>Notas</Label>

              <Input
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes:
                      event.target.value,
                  }))
                }
                placeholder="Opcional"
                className="h-11"
              />
            </div>

            <div className="flex gap-2 pt-1">
              {form.id && (
                <Button
                  variant="outline"
                  className="min-h-11 flex-1 touch-manipulation"
                  onClick={() =>
                    setForm(empty)
                  }
                >
                  Cancelar
                </Button>
              )}

              <Button
                className="min-h-12 flex-1 touch-manipulation rounded-xl bg-[#34a853] text-[15px] font-bold text-white shadow-sm hover:bg-[#2d8f47]"
                disabled={
                  save.isPending ||
                  !form.name.trim()
                }
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

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">
                  Clientes
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Busca por nombre, teléfono o correo.
                </p>
              </div>
            </div>

            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-12 rounded-xl border-[#e0e0e0] bg-[#fafafa] pl-10 text-[15px] shadow-none"
                placeholder="Buscar cliente…"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
              />
            </div>
          </CardHeader>

          <CardContent className="px-3 sm:px-6">
            <div className="mb-3 space-y-2.5">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9e9e9e]">
                  Saldo
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["all", "Todos"],
                      ["debt", "Con saldo"],
                      ["clear", "Sin saldo"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDebtFilter(key)}
                      className={
                        "rounded-xl px-2 py-2 text-center text-[12px] font-semibold transition " +
                        (debtFilter === key
                          ? "bg-[#7c4dff] text-white shadow-sm"
                          : "bg-[#f5f5f5] text-[#616161]")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9e9e9e]">
                  Convenio
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                  {(
                    [
                      ["all", "Todos"],
                      ["activo", "Activos"],
                      ["por_vencer", "Por vencer"],
                      ["vencido", "Vencidos"],
                      ["sin_fecha", "Sin fecha"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setStatusFilter(key as "all" | ConvenioStatus)
                      }
                      className={
                        "rounded-xl px-2 py-2 text-center text-[12px] font-semibold transition " +
                        (statusFilter === key
                          ? "bg-[#1a73e8] text-white shadow-sm"
                          : "bg-[#f5f5f5] text-[#616161]")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {schools.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9e9e9e]">
                    Escuela
                  </p>
                  <select
                    className="flex h-11 w-full rounded-xl border border-[#e0e0e0] bg-white px-3 text-sm shadow-sm"
                    value={schoolFilter}
                    onChange={(e) => setSchoolFilter(e.target.value)}
                  >
                    <option value="all">Todas las escuelas</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Móvil / tablet: tarjetas */}
            <div className="grid gap-2.5 lg:hidden">
              {filtered.map((customer) => {
                const stat = stats.get(customer.id);
                const balance = stat?.credit ?? 0;

                return (
                  <div
                    key={customer.id}
                    className={
                      "rounded-xl border bg-white p-3 shadow-sm active:bg-[#fafafa] " +
                      (scanHighlightId === customer.id
                        ? "border-[#1a73e8] ring-2 ring-[#1a73e8]/30"
                        : "border-[#e0e0e0]")
                    }
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-sm font-bold text-[#1a73e8]">
                        {(customer.name || "?").trim().charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="break-words text-[15px] font-bold leading-5 text-[#212121]">
                            {customer.name}
                          </p>
                          {balance > 0 ? (
                            <span className="shrink-0 rounded-full bg-[#fce4ec] px-2 py-0.5 text-[10px] font-bold text-[#c2185b]">
                              Con saldo
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-bold text-[#2e7d32]">
                              Al corriente
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[#757575]">
                          {customer.phone ?? "Sin teléfono"}
                        </p>
                        {customerCardCode(customer) ? (
                          <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-[#1a73e8]">
                            <QrCode className="h-3 w-3" />
                            {customerCardCode(customer)}
                          </p>
                        ) : null}
                        {(customer.school ||
                          customer.discount_type) && (
                          <p className="mt-0.5 text-[11px] text-[#5c6bc0]">
                            {customer.school
                              ? customer.school
                              : "Convenio"}
                            {customer.discount_type
                              ? ` · ${customer.discount_type}`
                              : ""}
                          </p>
                        )}
                        {(() => {
                          const st = convenioStatusOf(customer);
                          const meta = CONVENIO_META[st];
                          if (st === "sin_fecha" && !customer.school)
                            return null;
                          return (
                            <span
                              className={
                                "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold " +
                                meta.badge
                              }
                            >
                              {meta.label}
                            </span>
                          );
                        })()}
                        {customer.email ? (
                          <p className="mt-0.5 truncate text-[11px] text-[#9e9e9e]">
                            {customer.email}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[#f5f5f5] p-2.5">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">
                          Saldo
                        </p>
                        <p
                          className={
                            balance > 0
                              ? "mt-0.5 text-sm font-bold text-[#c62828]"
                              : "mt-0.5 text-sm font-bold text-[#212121]"
                          }
                        >
                          {money(balance)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">
                          Compras
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-[#212121]">
                          {stat?.count ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">
                          Total
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-[#212121]">
                          {money(stat?.total ?? 0)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#eeeeee] pt-3">
                      {balance > 0 ? (
                        <Button
                          size="sm"
                          className="h-10 flex-1 touch-manipulation rounded-lg bg-[#34a853] text-[13px] font-semibold text-white hover:bg-[#388e3c]"
                          onClick={() => {
                            setPayCustomerId(customer.id);
                            setPayAmount(balance.toFixed(2));
                            setPayMethod("cash");
                            setPayNotes("");
                          }}
                        >
                          <Wallet className="mr-1.5 h-4 w-4" />
                          Abonar
                        </Button>
                      ) : null}
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-10 w-10 touch-manipulation rounded-lg"
                        title="Ver historial de crédito"
                        onClick={() =>
                          setHistoryCustomerId(customer.id)
                        }
                      >
                        <History className="h-4 w-4" />
                      </Button>

                      <Button
                        size="icon"
                        variant="outline"
                        className="h-11 w-11 touch-manipulation"
                        title="Editar cliente"
                        onClick={() =>
                          setForm({
                            id: customer.id,
                            name: customer.name,
                            phone: customer.phone ?? "",
                            email: customer.email ?? "",
                            notes: customer.notes ?? "",
                            address: customer.address ?? "",
                            barcode: customerCardCode(customer),
                            whatsapp: customer.whatsapp ?? "",
                            school: customer.school ?? "",
                            school_id: customer.school_id ?? "",
                            discount_type: customer.discount_type ?? "",
                            start_date: customer.start_date ?? "",
                            end_date: customer.end_date ?? "",
                            active: customer.active !== false,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>

                      {isManager && (
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-11 w-11 touch-manipulation text-destructive"
                          title={
                            balance > 0
                              ? "No se puede eliminar con saldo pendiente"
                              : "Eliminar cliente"
                          }
                          disabled={
                            remove.isPending || balance > 0
                          }
                          onClick={() =>
                            remove.mutate(customer.id)
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {!isLoading && filtered.length === 0 && (
                <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                  {search.trim()
                    ? "No se encontraron clientes."
                    : "Sin clientes."}
                </div>
              )}
            </div>

            {/* Escritorio: tabla */}
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Cliente
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
                      Crédito
                    </TableHead>

                    <TableHead className="text-right">
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map(
                    (customer) => {
                      const stat =
                        stats.get(
                          customer.id,
                        );

                      const balance =
                        stat?.credit ?? 0;

                      return (
                        <TableRow
                          key={customer.id}
                        >
                          <TableCell>
                            <div className="min-w-[150px]">
                              <div className="font-medium">
                                {customer.name}
                              </div>

                              {customer.email && (
                                <div className="truncate text-xs text-muted-foreground">
                                  {customer.email}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="text-sm">
                            {customer.phone ??
                              "—"}
                          </TableCell>

                          <TableCell className="text-right">
                            {stat?.count ?? 0}
                          </TableCell>

                          <TableCell className="text-right font-medium">
                            {money(
                              stat?.total ??
                                0,
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            {balance > 0 ? (
                              <Badge variant="destructive">
                                {money(balance)}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                $0
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9"
                                title="Ver historial de crédito"
                                onClick={() =>
                                  setHistoryCustomerId(
                                    customer.id,
                                  )
                                }
                              >
                                <History className="h-3.5 w-3.5" />
                              </Button>

                              {balance > 0 && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9"
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

                                    setPayNotes(
                                      "",
                                    );
                                  }}
                                >
                                  <Wallet className="h-3.5 w-3.5" />
                                </Button>
                              )}

                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9"
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

                              {isManager && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 text-destructive"
                                  title={
                                    balance > 0
                                      ? "No se puede eliminar con saldo pendiente"
                                      : "Eliminar cliente"
                                  }
                                  disabled={
                                    remove.isPending ||
                                    balance > 0
                                  }
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
                    },
                  )}

                  {!isLoading &&
                    filtered.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-10 text-center text-muted-foreground"
                        >
                          {search.trim()
                            ? "No se encontraron clientes."
                            : "Sin clientes."}
                        </TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
      </>
      )}

      {section === "escuelas" && (
        <div className="space-y-3">
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-bold text-[#212121]">
                Escuelas con convenio
              </h2>
              <p className="text-xs leading-relaxed text-[#757575]">
                Beneficios para alumnas. Asigna cada cliente a su escuela.
              </p>
            </div>
            <Button
              type="button"
              className="h-11 w-full rounded-xl sm:w-auto"
              onClick={() => {
                setSchoolForm({
                  ...emptySchool,
                  start_date: todayString(),
                });
                setSchoolDialogOpen(true);
              }}
            >
              Nueva escuela
            </Button>
          </div>

          {schoolsLoading ? (
            <p className="text-sm text-muted-foreground">Cargando escuelas…</p>
          ) : schools.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Aún no hay escuelas. Crea la primera para registrar convenios.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {schools.map((school) => {
                const linked = customers.filter(
                  (c) =>
                    c.school_id === school.id ||
                    (c.school ?? "").trim() === school.name.trim(),
                );
                const activos = linked.filter((c) =>
                  benefitIsActive(c),
                ).length;
                const porVencer = linked.filter(
                  (c) => convenioStatusOf(c) === "por_vencer",
                ).length;
                const vencidos = linked.filter(
                  (c) => convenioStatusOf(c) === "vencido",
                ).length;

                return (
                  <Card
                    key={school.id}
                    className="rounded-xl border border-[#e0e0e0] shadow-sm"
                  >
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-[#212121]">
                            {school.name}
                          </p>
                          <p className="text-xs text-[#757575]">
                            {school.contact_name || "Sin contacto"}
                            {school.phone ? ` · ${school.phone}` : ""}
                          </p>
                          {school.discount_type ? (
                            <p className="mt-1 text-xs font-semibold text-[#1a73e8]">
                              Beneficio: {school.discount_type}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold " +
                            (school.active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600")
                          }
                        >
                          {school.active ? "Activa" : "Inactiva"}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="rounded-lg bg-emerald-50 px-1 py-1.5">
                          <p className="text-[10px] text-emerald-700">Activos</p>
                          <p className="text-sm font-bold text-emerald-700">
                            {activos}
                          </p>
                        </div>
                        <div className="rounded-lg bg-amber-50 px-1 py-1.5">
                          <p className="text-[10px] text-amber-700">Por vencer</p>
                          <p className="text-sm font-bold text-amber-700">
                            {porVencer}
                          </p>
                        </div>
                        <div className="rounded-lg bg-red-50 px-1 py-1.5">
                          <p className="text-[10px] text-red-700">Vencidos</p>
                          <p className="text-sm font-bold text-red-700">
                            {vencidos}
                          </p>
                        </div>
                      </div>

                      <p className="text-xs text-[#757575]">
                        {linked.length} alumna(s) / cliente(s) asignados
                        {school.end_date
                          ? ` · convenio hasta ${school.end_date}`
                          : ""}
                      </p>

                      <div className="grid grid-cols-3 gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 px-1 text-[11px]"
                          onClick={() => {
                            setSection("clientes");
                            setSchoolFilter(school.id);
                          }}
                        >
                          Clientes
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 px-1 text-[11px]"
                          onClick={() => {
                            setSchoolForm({
                              id: school.id,
                              name: school.name,
                              contact_name: school.contact_name ?? "",
                              phone: school.phone ?? "",
                              discount_type: school.discount_type ?? "",
                              start_date: school.start_date ?? "",
                              end_date: school.end_date ?? "",
                              notes: school.notes ?? "",
                              active: school.active,
                            });
                            setSchoolDialogOpen(true);
                          }}
                        >
                          <Pencil className="mr-0.5 h-3 w-3" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 px-1 text-[11px] text-red-600"
                          onClick={() => {
                            if (
                              confirm(
                                `¿Eliminar la escuela ${school.name}?`,
                              )
                            ) {
                              removeSchool.mutate(school.id);
                            }
                          }}
                        >
                          <Trash2 className="mr-0.5 h-3 w-3" />
                          Borrar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Diálogo escuela */}
      <Dialog
        open={schoolDialogOpen}
        onOpenChange={(open) => {
          setSchoolDialogOpen(open);
          if (!open) setSchoolForm(emptySchool);
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {schoolForm.id ? "Editar escuela" : "Nueva escuela"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label>Nombre de la escuela *</Label>
              <Input
                className="mt-1 h-11"
                value={schoolForm.name}
                onChange={(e) =>
                  setSchoolForm((c) => ({ ...c, name: e.target.value }))
                }
                placeholder="Ej. CBTIS 45, Secundaria..."
              />
            </div>
            <div>
              <Label>Contacto</Label>
              <Input
                className="mt-1 h-11"
                value={schoolForm.contact_name}
                onChange={(e) =>
                  setSchoolForm((c) => ({
                    ...c,
                    contact_name: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input
                className="mt-1 h-11"
                value={schoolForm.phone}
                onChange={(e) =>
                  setSchoolForm((c) => ({ ...c, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Beneficio / descuento del convenio</Label>
              <Input
                className="mt-1 h-11"
                value={schoolForm.discount_type}
                onChange={(e) =>
                  setSchoolForm((c) => ({
                    ...c,
                    discount_type: e.target.value,
                  }))
                }
                placeholder="Ej. 10%, 15% en pestañas..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Inicio</Label>
                <Input
                  type="date"
                  className="mt-1 h-11"
                  value={schoolForm.start_date}
                  onChange={(e) =>
                    setSchoolForm((c) => ({
                      ...c,
                      start_date: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Vencimiento</Label>
                <Input
                  type="date"
                  className="mt-1 h-11"
                  value={schoolForm.end_date}
                  onChange={(e) =>
                    setSchoolForm((c) => ({
                      ...c,
                      end_date: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Input
                className="mt-1 h-11"
                value={schoolForm.notes}
                onChange={(e) =>
                  setSchoolForm((c) => ({ ...c, notes: e.target.value }))
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={schoolForm.active}
                onChange={(e) =>
                  setSchoolForm((c) => ({
                    ...c,
                    active: e.target.checked,
                  }))
                }
              />
              Convenio activo
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSchoolDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={saveSchool.isPending}
              onClick={() => saveSchool.mutate()}
            >
              {saveSchool.isPending ? "Guardando…" : "Guardar escuela"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Registrar abono
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
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

            <div>
              <Label>Monto</Label>

              <Input
                type="number"
                min="0.01"
                max={
                  paymentCustomerBalance >
                  0
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
                  El sistema buscará
                  automáticamente la caja
                  abierta y registrará el
                  efectivo como entrada.
                </p>
              )}
            </div>

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

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-lg"
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
              className="h-11 min-w-[8rem] rounded-lg bg-[#43a047] text-[15px] font-bold text-white hover:bg-[#388e3c]"
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
                : "Confirmar abono"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreditHistoryDialog
        open={!!historyCustomerId}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryCustomerId(null);
          }
        }}
        customerId={historyCustomerId}
        customerName={
          historyCustomer?.name
        }
        balance={historyBalance}
      />
    </PageShell>
  );
} 