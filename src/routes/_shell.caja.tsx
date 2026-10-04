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
 * BLOQUE 1 — Visual estilo Zobaze (entrada Caja):
 * - Tarjeta grande NUEVA VENTA
 * - AGREGAR NUEVO GASTO (navega a /gastos, lógica existente)
 * - Ventas pendientes vía listParkedSales (sin lógica nueva)
 * No se toca el motor del POS ni de caja.
 */

import { useEffect, useState } from "react";
import { consumeOpenPosFlag } from "@/lib/globalBarcode";
import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  ShoppingBag,
  Wallet,
  Plus,
  ArrowLeft,
  Receipt,
  ChevronRight,
  PauseCircle,
} from "lucide-react";
import { POSPanel } from "@/components/pos/POSPanel";
import { CashDrawerPanel } from "@/components/cash/CashDrawerPanel";
import { cn } from "@/lib/utils";
import { useBranch } from "@/lib/branch";
import { supabase } from "@/integrations/supabase/client";
import { listParkedSales } from "@/lib/parkedSales";
import { money } from "@/lib/format";

export const Route = createFileRoute("/_shell/caja")({
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
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("pos");
  // Solo afecta la UI móvil/tablet: home estilo Zobaze vs POS/Arqueo
  const [mobileView, setMobileView] =
    useState<MobileView>("home");

  // Si se pistoleó un código, abrir el POS de inmediato
  useEffect(() => {
    const openPos = () => {
      setTab("pos");
      setMobileView("pos");
    };
    if (consumeOpenPosFlag()) {
      openPos();
    }
    const onScan = () => openPos();
    window.addEventListener("lula-barcode-scan", onScan);
    return () =>
      window.removeEventListener("lula-barcode-scan", onScan);
  }, []);

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

  const { branchId, branches, loading } = useBranch();

  const activeBranch = branches.find(
    (branch) => branch.id === branchId,
  );

  // Ventas pendientes = parked_sales existentes (misma lógica del POS)
  const { data: parkedSales = [] } = useQuery({
    queryKey: ["parked-sales-home", branchId],
    enabled: !!branchId && isCompact && mobileView === "home",
    queryFn: () => listParkedSales(supabase, branchId!),
    refetchOnWindowFocus: true,
  });

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
            No se puede abrir Caja hasta que exista una sucursal
            disponible para este usuario.
          </p>
          {branches.length === 0 && (
            <p className="mt-3 rounded-xl bg-[#fff7ed] p-3 text-xs text-[#9a3412]">
              Verifica que la sucursal esté activa y que tu
              usuario tenga permiso para utilizarla.
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
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-0.5 pt-1">
      {/* Tarjeta principal NUEVA VENTA — idéntica a referencia Zobaze */}
      <button
        type="button"
        onClick={() => {
          setTab("pos");
          setMobileView("pos");
        }}
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[#e0e0e0] bg-white px-6 py-12 shadow-sm transition active:scale-[0.985]"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#34a853] text-white shadow-md">
          <Plus className="h-8 w-8" strokeWidth={2.75} />
        </div>
        <span className="text-[15px] font-bold tracking-wide text-[#212121]">
          NUEVA VENTA
        </span>
      </button>

      {/* AGREGAR NUEVO GASTO — navega a módulo Gastos existente */}
      <button
        type="button"
        onClick={() => navigate({ to: "/gastos" })}
        className="flex items-center justify-center gap-2.5 rounded-xl border border-[#e0e0e0] bg-white px-4 py-3.5 text-sm font-semibold text-[#212121] shadow-sm transition active:scale-[0.985]"
      >
        <Wallet className="h-5 w-5 shrink-0 text-[#34a853]" />
        <span>AGREGAR NUEVO GASTO</span>
      </button>

      {/* Ventas pendientes (en espera) — parked_sales existente */}
      <div className="mt-1">
        <button
          type="button"
          onClick={() => {
            setTab("pos");
            setMobileView("pos");
          }}
          className="mb-2 flex w-full items-center justify-between gap-2 px-0.5"
        >
          <p className="text-sm font-semibold text-[#212121]">
            Ventas pendientes (en espera)
            {parkedSales.length > 0
              ? `: ${parkedSales.length}`
              : ":"}
          </p>
          <ChevronRight className="h-5 w-5 shrink-0 text-[#1a73e8]" />
        </button>

        {parkedSales.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e0e0e0] bg-white/80 px-4 py-8 text-center">
            <PauseCircle className="mx-auto mb-2 h-8 w-8 text-[#c5cad3]" />
            <p className="text-sm text-[#9aa3b8]">
              No hay ventas en espera
            </p>
            <p className="mt-1 text-xs text-[#b0b7c3]">
              Las ventas pausadas desde el POS aparecerán aquí
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
            {parkedSales.slice(0, 5).map((sale, idx) => {
              const cartTotal = (sale.cart ?? []).reduce(
                (sum, line) =>
                  sum +
                  Number(line.unit_price ?? 0) *
                    Number(line.quantity ?? 0) -
                  Number(line.discount ?? 0),
                0,
              );
              const lines = (sale.cart ?? []).length;
              return (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => {
                    setTab("pos");
                    setMobileView("pos");
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[#f8f9fa]",
                    idx < Math.min(parkedSales.length, 5) - 1 &&
                      "border-b border-[#f0f0f0]",
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff4df] text-[#a86d00]">
                    <PauseCircle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#212121]">
                      {sale.label?.trim() ||
                        `Venta en espera · ${lines} art.`}
                    </p>
                    <p className="text-xs text-[#757575]">
                      {new Date(sale.created_at).toLocaleString(
                        "es-MX",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        },
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-[#1a73e8]">
                    {money(cartTotal - Number(sale.ticket_discount ?? 0))}
                  </p>
                </button>
              );
            })}
            {parkedSales.length > 5 && (
              <button
                type="button"
                onClick={() => {
                  setTab("pos");
                  setMobileView("pos");
                }}
                className="w-full border-t border-[#f0f0f0] py-2.5 text-center text-xs font-semibold text-[#1a73e8]"
              >
                Ver las {parkedSales.length} ventas en espera
              </button>
            )}
          </div>
        )}
      </div>

      {/* Acceso secundario a Arqueo (conserva funcionalidad) */}
      <button
        type="button"
        onClick={() => {
          setTab("arqueo");
          setMobileView("arqueo");
        }}
        className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-transparent bg-transparent px-4 py-2.5 text-sm font-medium text-[#1a73e8] active:bg-[#e8f0fe]"
      >
        <Receipt className="h-4 w-4" />
        Ir a arqueo de caja
      </button>
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
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full text-[#1a73e8]",
              !isCompact && "hidden",
            )}
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
        {tabs.map(({ id, label, icon: Icon }) => (
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
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "pos" ? (
          <POSPanel key={`pos-${branchId}`} className="h-full" />
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
        mobileView === "home" ? (
          mobileHome
        ) : (
          mainContent
        )
      ) : (
        mainContent
      )}
    </>
  );
}
