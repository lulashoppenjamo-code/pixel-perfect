/**
 * LULA OS — ARQUEO DE CAJA
 *
 * Caja:
 * - apertura
 * - ventas en efectivo
 * - efectivo proveniente de pagos mixtos
 * - abonos de crédito en efectivo
 * - entradas
 * - salidas
 * - gastos en efectivo
 * - cierre
 *
 * IMPORTANTE:
 * El efectivo de las ventas se obtiene desde sale_payments,
 * NO desde sales.payment_method cuando la venta es mixta.
 */

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { toast } from "sonner";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  Unlock,
  Wallet,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MovementType = "deposit" | "withdrawal";

type CashSummary = {
  cashSales: number;
  mixedCash: number;
  creditPaymentsCash: number;
  deposits: number;
  withdrawals: number;
  cashExpenses: number;
  expected: number;
  movements: Array<{
    id: string;
    type: MovementType;
    amount: number;
    reason: string | null;
    created_at: string;
  }>;
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-MX");

export function CashDrawerPanel({
  className,
}: {
  className?: string;
}) {
  const { branchId } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [opening, setOpening] = useState("");

  const [mvType, setMvType] =
    useState<MovementType>("withdrawal");

  const [mvAmount, setMvAmount] = useState("");
  const [mvReason, setMvReason] = useState("");

  const [closeOpen, setCloseOpen] =
    useState(false);

  const [counted, setCounted] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({
      queryKey: ["cash-session"],
    });

    void qc.invalidateQueries({
      queryKey: ["cash-session-totals"],
    });

    void qc.invalidateQueries({
      queryKey: ["closed-sessions"],
    });

    void qc.invalidateQueries({
      queryKey: ["credit-payments"],
    });
  };

  // ============================================================
  // CAJA ABIERTA
  // ============================================================

  const { data: session } = useQuery({
    queryKey: ["cash-session", branchId],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("cash_sessions")
          .select("*")
          .eq("branch_id", branchId!)
          .eq("status", "open")
          .order("opened_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

      if (error) throw error;

      return data;
    },
  });

  // ============================================================
  // RESUMEN REAL DE CAJA
  // ============================================================

  const { data: summary } =
    useQuery<CashSummary>({
      queryKey: [
        "cash-session-totals",
        session?.id,
      ],

      enabled: !!session?.id,

      queryFn: async () => {
        const id = session!.id;

        // ------------------------------------------------------
        // TODOS LOS PAGOS DE LAS VENTAS
        // ------------------------------------------------------

        const salePayments =
          await supabase
            .from("sale_payments")
            .select(
              `
                id,
                sale_id,
                payment_method,
                amount
              `,
            )
            .eq(
              "sale_id",
              // placeholder replaced below by sales query
              "00000000-0000-0000-0000-000000000000",
            );

        // ------------------------------------------------------
        // OBTENER VENTAS DE LA SESIÓN
        // ------------------------------------------------------

        const salesRes =
          await supabase
            .from("sales")
            .select(
              "id,status,payment_method",
            )
            .eq(
              "cash_session_id",
              id,
            )
            .in("status", [
              "completed",
              "partially_refunded",
            ]);

        if (salesRes.error) {
          throw salesRes.error;
        }

        const sales =
          salesRes.data ?? [];

        const saleIds =
          sales.map((sale) => sale.id);

        let payments: Array<{
          id: string;
          sale_id: string;
          payment_method: string;
          amount: number;
        }> = [];

        if (saleIds.length > 0) {
          const { data, error } =
            await supabase
              .from("sale_payments")
              .select(
                "id,sale_id,payment_method,amount",
              )
              .in(
                "sale_id",
                saleIds,
              );

          if (error) throw error;

          payments =
            (data ?? []).map((row) => ({
              ...row,
              amount: Number(
                row.amount ?? 0,
              ),
            }));
        }

        // ------------------------------------------------------
        // EFECTIVO REAL
        // ------------------------------------------------------

        let cashSales = 0;
        let mixedCash = 0;

        for (const payment of payments) {
          if (
            payment.payment_method ===
            "cash"
          ) {
            cashSales += payment.amount;
          }

          /*
           * Después de la normalización de pagos mixtos,
           * los componentes reales quedan como cash/card.
           *
           * Esta condición conserva compatibilidad con
           * registros antiguos que todavía tengan mixed.
           */
          if (
            payment.payment_method ===
            "mixed"
          ) {
            mixedCash += payment.amount;
          }
        }

        // ------------------------------------------------------
        // ABONOS DE CRÉDITO EN EFECTIVO
        //
        // Se detectan por cash_movements asociados a la caja.
        // La RPC register_credit_payment() crea la entrada.
        // ------------------------------------------------------

        const [
          movementsRes,
          expensesRes,
          creditMovementsRes,
        ] = await Promise.all([
          supabase
            .from("cash_movements")
            .select(
              "id,type,amount,reason,created_at",
            )
            .eq(
              "cash_session_id",
              id,
            )
            .order("created_at", {
              ascending: false,
            }),

          supabase
            .from("expenses")
            .select("amount")
            .eq(
              "cash_session_id",
              id,
            )
            .eq(
              "payment_method",
              "cash",
            ),

          /*
           * Los abonos de crédito en efectivo
           * llegan como depósitos de caja.
           *
           * No se vuelven a sumar aquí si ya
           * están incluidos en movements.
           *
           * Este query queda reservado para
           * compatibilidad/visualización.
           */
          Promise.resolve({
            data: [],
            error: null,
          }),
        ]);

        void creditMovementsRes;

        if (movementsRes.error) {
          throw movementsRes.error;
        }

        if (expensesRes.error) {
          throw expensesRes.error;
        }

        const movements =
          (movementsRes.data ?? []).map(
            (movement) => ({
              ...movement,
              amount: Number(
                movement.amount ?? 0,
              ),
            }),
          );

        // ------------------------------------------------------
        // ENTRADAS / SALIDAS
        // ------------------------------------------------------

        const deposits =
          movements
            .filter(
              (movement) =>
                movement.type ===
                "deposit",
            )
            .reduce(
              (sum, movement) =>
                sum +
                movement.amount,
              0,
            );

        const withdrawals =
          movements
            .filter(
              (movement) =>
                movement.type ===
                "withdrawal",
            )
            .reduce(
              (sum, movement) =>
                sum +
                movement.amount,
              0,
            );

        // ------------------------------------------------------
        // GASTOS EN EFECTIVO
        // ------------------------------------------------------

        const cashExpenses =
          (expensesRes.data ?? [])
            .reduce(
              (sum, expense) =>
                sum +
                Number(
                  expense.amount ?? 0,
                ),
              0,
            );

        // ------------------------------------------------------
        // IMPORTANTE
        //
        // Los abonos en efectivo registrados por
        // register_credit_payment() llegan como
        // deposit dentro de cash_movements.
        //
        // Por eso NO los sumamos otra vez.
        // ------------------------------------------------------

        const creditPaymentsCash = 0;

        const expected =
          Number(
            session!.opening_amount ??
              0,
          ) +
          cashSales +
          mixedCash +
          creditPaymentsCash +
          deposits -
          withdrawals -
          cashExpenses;

        return {
          cashSales,
          mixedCash,
          creditPaymentsCash,
          deposits,
          withdrawals,
          cashExpenses,
          expected,
          movements,
        };
      },
    });

  // ============================================================
  // CAJAS CERRADAS
  // ============================================================

  const {
    data: closedSessions = [],
  } = useQuery({
    queryKey: [
      "closed-sessions",
      branchId,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("cash_sessions")
          .select("*")
          .eq(
            "branch_id",
            branchId!,
          )
          .eq(
            "status",
            "closed",
          )
          .order("closed_at", {
            ascending: false,
          })
          .limit(8);

      if (error) throw error;

      return data ?? [];
    },
  });

  // ============================================================
  // ABRIR CAJA
  // ============================================================

  const openBox = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error(
          "Elige una sucursal",
        );
      }

      if (!user) {
        throw new Error(
          "Sesión no válida",
        );
      }

      const openingAmount =
        Number(opening) || 0;

      if (openingAmount < 0) {
        throw new Error(
          "El efectivo inicial no puede ser negativo",
        );
      }

      const { error } =
        await supabase
          .from("cash_sessions")
          .insert({
            branch_id: branchId,
            opened_by: user.id,
            opening_amount:
              openingAmount,
            status: "open",
          });

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        "Caja abierta",
      );

      setOpening("");

      invalidate();
    },

    onError: (error: Error) =>
      toast.error(
        error.message ||
          "No se pudo abrir la caja",
      ),
  });

  // ============================================================
  // MOVIMIENTO
  // ============================================================

  const addMovement = useMutation({
    mutation