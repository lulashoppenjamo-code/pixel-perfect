/**
 * Caja — LULA OS
 * Ruta: src/routes/_shell.caja.tsx
 * Dos pestañas sobre la sucursal activa:
 *  - Punto de venta: el POS real (carrito, cobro, ticket).
 *  - Arqueo: abrir/cerrar la sesión de caja, entradas y salidas de dinero y
 *    cuánto debe haber en el cajón.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { ShoppingBag, Wallet } from "lucide-react";
import { POSPanel } from "@/components/pos/POSPanel";
import { CashDrawerPanel } from "@/components/cash/CashDrawerPanel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/caja")({
  head: () => ({
    meta: [
      { title: "Caja — Lula OS" },
      {
        name: "description",
        content: "Punto de venta y arqueo de caja de Lula Shop OS.",
      },
      { property: "og:title", content: "Caja — Lula OS" },
      {
        property: "og:description",
        content: "Vende, cobra y cuadra el efectivo de tu sucursal.",
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
  const [tab, setTab] = useState<Tab>("pos");

  const tabs = [
    { id: "pos" as const, label: "Punto de venta", icon: ShoppingBag },
    { id: "arqueo" as const, label: "Arqueo", icon: Wallet },
  ];

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-3">
      <div className="flex shrink-0 gap-1.5 rounded-xl border border-[#e2e8f0] bg-white p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              tab === id ? "bg-[#4169e2] text-white shadow-sm" : "text-[#4b5563] hover:bg-[#eef1f8]",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "pos" ? <POSPanel className="h-full" /> : <CashDrawerPanel className="h-full" />}
      </div>
    </div>
  );
}
