/**
 * Caja — LULA OS
 * Ruta: src/routes/_shell.caja.tsx
 *
 * Dos pestañas sobre la sucursal activa:
 *  - Punto de venta: POS real.
 *  - Arqueo: apertura, movimientos y cierre de caja.
 *
 * La sucursal activa es controlada por BranchProvider.
 * POS y Arqueo se remueven y montan nuevamente cuando
 * cambia la sucursal para evitar conservar estado de
 * la sucursal anterior.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { ShoppingBag, Wallet } from "lucide-react";
import { POSPanel } from "@/components/pos/POSPanel";
import { CashDrawerPanel } from "@/components/cash/CashDrawerPanel";
import { cn } from "@/lib/utils";
import { useBranch } from "@/lib/branch";

export const Route = createFileRoute(
  "/_shell/caja",
)({
  head: () => ({
    meta: [
      {
        title: "Caja — Lula OS",
      },
      {
        name: "description",
        content:
          "Punto de venta y arqueo de caja de Lula Shop OS.",
      },
      {
        property: "og:title",
        content: "Caja — Lula OS",
      },
      {
        property: "og:description",
        content:
          "Vende, cobra y cuadra el efectivo de tu sucursal.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="caja">
      <CajaPage />
    </RequireNavAccess>
  ),
});

type Tab = "pos" | "arqueo";

function CajaPage() {
  const [tab, setTab] =
    useState<Tab>("pos");

  const {
    branchId,
    branches,
    loading,
  } = useBranch();

  const activeBranch =
    branches.find(
      (branch) =>
        branch.id === branchId,
    );

  const tabs = [
    {
      id: "pos" as const,
      label: "Punto de venta",
      icon: ShoppingBag,
    },
    {
      id: "arqueo" as const,
      label: "Arqueo",
      icon: Wallet,
    },
  ];

  /*
   * Nunca mostramos el POS con una sucursal
   * todavía indefinida.
   */
  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-3rem)] items-center justify-center">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white px-6 py-5 text-center shadow-sm">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#4169e2] border-t-transparent" />

          <p className="text-sm font-semibold text-[#1a1d26]">
            Cargando sucursal…
          </p>

          <p className="mt-1 text-xs text-[#9aa3b8]">
            Preparando caja y punto de venta
          </p>
        </div>
      </div>
    );
  }

  if (!branchId || !activeBranch) {
    return (
      <div className="flex h-[calc(100dvh-3rem)] items-center justify-center">
        <div className="max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f3f9]">
            <ShoppingBag className="h-6 w-6 text-[#9aa3b8]" />
          </div>

          <h2 className="text-base font-bold text-[#1a1d26]">
            No hay una sucursal activa
          </h2>

          <p className="mt-2 text-sm text-[#6b7280]">
            No se puede abrir Caja hasta que
            exista una sucursal disponible para
            este usuario.
          </p>

          {branches.length === 0 && (
            <p className="mt-3 rounded-xl bg-[#fff7ed] p-3 text-xs text-[#9a3412]">
              Verifica que la sucursal esté activa
              y que tu usuario tenga permiso para
              utilizarla.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
            Sucursal activa
          </p>

          <p className="truncate text-sm font-bold text-[#1a1d26]">
            {activeBranch.name}
          </p>
        </div>

        <div className="hidden rounded-full bg-[#eef2fe] px-3 py-1.5 text-xs font-semibold text-[#4169e2] sm:block">
          Caja
        </div>
      </div>

      <div className="flex shrink-0 gap-1.5 rounded-xl border border-[#e2e8f0] bg-white p-1">
        {tabs.map(
          ({
            id,
            label,
            icon: Icon,
          }) => (
            <button
              key={id}
              type="button"
              onClick={() =>
                setTab(id)
              }
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                tab === id
                  ? "bg-[#4169e2] text-white shadow-sm"
                  : "text-[#4b5563] hover:bg-[#eef1f8]",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ),
        )}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "pos" ? (
          /*
           * IMPORTANTE:
           * El key obliga a React a crear un POS
           * completamente nuevo cuando cambia branchId.
           *
           * Esto evita:
           * - carrito de otra sucursal
           * - cliente seleccionado de otra operación
           * - caja abierta visualmente de otra sucursal
           * - historial/cache local del POS anterior
           */
          <POSPanel
            key={`pos-${branchId}`}
            className="h-full"
          />
        ) : (
          <CashDrawerPanel
            key={`cash-${branchId}`}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}