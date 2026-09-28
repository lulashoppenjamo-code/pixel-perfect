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
 *
 * CAMBIOS VISUALES:
 * - Pantalla de entrada móvil estilo Zobaze (botón NUEVA VENTA).
 * - Estilos de tabs.
 * No se toca el motor del POS ni de caja.
 */

import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  ShoppingBag,
  Wallet,
  Plus,
  ArrowLeft,
  Receipt,
} from "lucide-react";
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
type MobileView = "home" | "pos" | "arqueo";

function CajaPage() {
  const [tab, setTab] = useState<Tab>("pos");
  // Solo afecta la UI móvil/tablet: home estilo Zobaze vs POS/Arqueo
  const [mobileView, setMobileView] =
    useState<MobileView>("home");

  // Tablet (cualquier orientación) y teléfono: flujo secuencial con home
  const [isCompact, setIsCompact] = useState(true);
  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      const coarse =
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches;
      const narrow = window.innerWidth < 1400;
      setIsCompact(coarse || narrow);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

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

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-3rem)] items-center justify-center">
        <div className="rounded-2xl border border-[#e0e0e0] bg-white px-6 py-5 text-center shadow-sm">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />

          <p className="text-sm font-semibold text-[#212121]">
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
        <div className="max-w-md rounded-2xl border border-[#e0e0e0] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f3f9]">
            <ShoppingBag className="h-6 w-6 text-[#9aa3b8]" />
          </div>

          <h2 className="text-base font-bold text-[#212121]">
            No hay una sucursal activa
          </h2>

          <p className="mt-2 text-sm text-[#757575]">
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

  /* =========================================================
     MÓVIL — Pantalla de entrada estilo Zobaze
     ========================================================= */
  const mobileHome = (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      {/* Botón grande NUEVA VENTA */}
      <button
        type="button"
        onClick={() => {
          setTab("pos");
          setMobileView("pos");
        }}
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[#e0e0e0] bg-white px-6 py-10 shadow-sm transition active:scale-[0.98]"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#34a853] text-white shadow-md">
          <Plus className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <span className="text-base font-bold tracking-wide text-[#212121]">
          NUEVA VENTA
        </span>
      </button>

      {/* Botón Agregar gasto / Arqueo */}
      <button
        type="button"
        onClick={() => {
          setTab("arqueo");
          setMobileView("arqueo");
        }}
        className="flex items-center justify-center gap-2.5 rounded-xl border border-[#e0e0e0] bg-white px-4 py-3.5 text-sm font-semibold text-[#212121] shadow-sm transition active:scale-[0.98]"
      >
        <Wallet className="h-5 w-5 text-[#34a853]" />
        ARQUEO / CAJA
      </button>

      {/* Sección tipo historial (solo visual) */}
      <div className="mt-2">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#212121]">
            Accesos rápidos
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
          <button
            type="button"
            onClick={() => {
              setTab("pos");
              setMobileView("pos");
            }}
            className="flex w-full items-center gap-3 border-b border-[#f0f0f0] px-4 py-3.5 text-left active:bg-[#f8f9fa]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#212121]">
                Abrir punto de venta
              </p>
              <p className="text-xs text-[#757575]">
                Vender productos y cobrar
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setTab("arqueo");
              setMobileView("arqueo");
            }}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[#f8f9fa]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f5e9] text-[#34a853]">
              <Receipt className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#212121]">
                Ver arqueo de caja
              </p>
              <p className="text-xs text-[#757575]">
                Apertura, movimientos y cierre
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );

  /* =========================================================
     CONTENIDO PRINCIPAL (desktop siempre, móvil según vista)
     ========================================================= */
  const mainContent = (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-3">
      {/* Header sucursal — desktop / cuando ya está en POS o Arqueo */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Botón volver solo en móvil cuando no está en home */}
          <button
            type="button"
            onClick={() => setMobileView("home")}
            className={cn("flex h-9 w-9 items-center justify-center rounded-full text-[#1a73e8]", !isCompact && "hidden")}
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
              Sucursal activa
            </p>
            <p className="truncate text-sm font-bold text-[#212121]">
              {activeBranch.name}
            </p>
          </div>
        </div>

        <div className="hidden rounded-full bg-[#e8f0fe] px-3 py-1.5 text-xs font-semibold text-[#1a73e8] sm:block">
          Caja
        </div>
      </div>

      {/* Tabs — visibles en desktop siempre; en móvil solo cuando ya entró a POS/Arqueo */}
      <div
        className={cn(
          "flex shrink-0 gap-1 rounded-xl border border-[#e0e0e0] bg-white p-1 shadow-sm",
          "md:flex",
          mobileView === "home" ? "hidden" : "flex",
        )}
      >
        {tabs.map(
          ({
            id,
            label,
            icon: Icon,
          }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setMobileView(id);
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all",
                tab === id
                  ? "bg-[#1a73e8] text-white shadow-sm"
                  : "text-[#5f6368] hover:bg-[#f1f3f4]",
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

  return (
    <>
      {/* Teléfono y tablet (cualquier orientación): home o flujo secuencial */}
      {isCompact ? (
        mobileView === "home" ? mobileHome : mainContent
      ) : (
        mainContent
      )}
    </>
  );
}