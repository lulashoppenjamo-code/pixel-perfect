/**
 * Configuración visual del ticket térmico — LULA OS
 * Usa la tabla settings (key/value) sin migraciones nuevas.
 *
 * Claves:
 * - company_name
 * - company_address
 * - company_phone
 * - ticket_footer
 * - ticket_layout  (JSON con opciones de visualización)
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  Printer,
  Receipt,
  Save,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import {
  cacheTicketLayout,
  DEFAULT_TICKET_LAYOUT,
  getBluetoothPrinterName,
  normalizeTicketLayout,
  printTicketBluetooth,
  type TicketPrintLayout,
} from "@/lib/bluetoothPrinter";
import type { TicketData } from "@/components/pos/TicketModal";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";



type FormState = {
  company_name: string;
  company_address: string;
  company_phone: string;
  ticket_footer: string;
  layout: TicketPrintLayout;
};

async function upsertSetting(
  branchId: string,
  key: string,
  value: unknown,
) {
  const { data: existing, error: findError } = await supabase
    .from("settings")
    .select("id")
    .eq("branch_id", branchId)
    .eq("key", key)
    .maybeSingle();

  if (findError) throw findError;

  if (existing?.id) {
    const { error } = await supabase
      .from("settings")
      .update({ value: value as never })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("settings").insert({
    branch_id: branchId,
    key,
    value: value as never,
  });
  if (error) throw error;
}

function parseSettingValue(raw: unknown, fallback: string): string {
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
      return raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  return fallback;
}


export function TicketPrinterSettings() {
  const { branchId, branches } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>({
    company_name: "Lula Shop",
    company_address: "",
    company_phone: "",
    ticket_footer: "¡Gracias por su compra!",
    layout: { ...DEFAULT_TICKET_LAYOUT },
  });
  const [printing, setPrinting] = useState(false);

  const branchName =
    branches.find((b) => b.id === branchId)?.name ?? "Sucursal";

  const { data: settingsRows = [], isLoading } = useQuery({
    queryKey: ["settings", branchId, "ticket-printer"],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key, value")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!settingsRows.length && isLoading) return;

    const map = new Map(
      settingsRows.map((row) => [row.key, row.value]),
    );

    setForm({
      company_name: parseSettingValue(
        map.get("company_name"),
        "Lula Shop",
      ),
      company_address: parseSettingValue(
        map.get("company_address"),
        "",
      ),
      company_phone: parseSettingValue(
        map.get("company_phone"),
        "",
      ),
      ticket_footer: parseSettingValue(
        map.get("ticket_footer"),
        "¡Gracias por su compra!",
      ),
      layout: normalizeTicketLayout(map.get("ticket_layout")),
    });
    cacheTicketLayout(normalizeTicketLayout(map.get("ticket_layout")));
  }, [settingsRows, isLoading]);

  const previewTicket: TicketData = useMemo(() => {
    const lines = [
      {
        name: "Producto ejemplo",
        quantity: 1,
        unit_price: 150,
        discount: 0,
        total: 150,
      },
      {
        name: "Producto con descuento",
        quantity: 2,
        unit_price: 160,
        discount: 20,
        total: 300,
      },
    ];
    const subtotal = 450;
    const tax = form.layout.showTaxes ? 0 : 0;
    const discount = form.layout.showDiscounts ? 0 : 0;
    return {
      companyName: form.company_name || "Lula Shop",
      branchName: form.layout.showBranch ? branchName : undefined,
      folio: "000123",
      date: new Date().toLocaleString("es-MX"),
      cashierName: form.layout.showCashier ? "María" : undefined,
      customerName: form.layout.showCustomer
        ? "Cliente general"
        : undefined,
      paymentMethod: "Efectivo",
      lines,
      subtotal,
      tax,
      discount,
      total: 450,
      cashReceived: form.layout.showCashReceived ? 500 : null,
      changeGiven: form.layout.showChange ? 50 : null,
      footer: form.ticket_footer || undefined,
    };
  }, [form, branchName]);

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error("No hay una sucursal activa.");
      }

      await upsertSetting(
        branchId,
        "company_name",
        form.company_name.trim() || "Lula Shop",
      );
      await upsertSetting(
        branchId,
        "company_address",
        form.company_address.trim(),
      );
      await upsertSetting(
        branchId,
        "company_phone",
        form.company_phone.trim(),
      );
      await upsertSetting(
        branchId,
        "ticket_footer",
        form.ticket_footer.trim() || "¡Gracias por su compra!",
      );
      await upsertSetting(branchId, "ticket_layout", form.layout);
      cacheTicketLayout(form.layout);
    },
    onSuccess: () => {
      toast.success("Configuración del ticket guardada.");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["settings-pos"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la configuración del ticket.",
      );
    },
  });

  const printTest = async () => {
    const printer = getBluetoothPrinterName();
    if (!printer) {
      toast.error("No hay una impresora Bluetooth configurada.");
      return;
    }

    setPrinting(true);
    try {
      const copies = Math.max(1, form.layout.copies || 1);
      for (let i = 0; i < copies; i += 1) {
        await printTicketBluetooth(previewTicket, form.layout);
      }
      toast.success("Ticket de prueba enviado a la impresora.");
    } catch (error) {
      console.error("Ticket test print:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo imprimir el ticket de prueba.",
      );
    } finally {
      setPrinting(false);
    }
  };

  const setLayout = <K extends keyof TicketPrintLayout>(
    key: K,
    value: TicketPrintLayout[K],
  ) => {
    setForm((prev) => ({
      ...prev,
      layout: { ...prev.layout, [key]: value },
    }));
  };

  const paperWidthPx =
    form.layout.paperWidth === 80 ? 280 : 220;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Configuración del ticket
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[1fr_minmax(220px,280px)]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nombre del negocio</Label>
              <Input
                value={form.company_name}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    company_name: e.target.value,
                  }))
                }
                placeholder="Lula Shop"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Dirección</Label>
              <Input
                value={form.company_address}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    company_address: e.target.value,
                  }))
                }
                placeholder="Pénjamo, Guanajuato"
              />
            </div>

            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input
                value={form.company_phone}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    company_phone: e.target.value,
                  }))
                }
                placeholder="469 000 0000"
              />
            </div>

            <div className="space-y-2">
              <Label>Ancho del ticket</Label>
              <Select
                value={String(form.layout.paperWidth)}
                onValueChange={(v) =>
                  setLayout(
                    "paperWidth",
                    Number(v) === 80 ? 80 : 58,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">58 mm</SelectItem>
                  <SelectItem value="80">80 mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Texto inferior del ticket</Label>
              <Textarea
                value={form.ticket_footer}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    ticket_footer: e.target.value,
                  }))
                }
                placeholder="¡Gracias por su compra!"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Número de copias</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={form.layout.copies}
                onChange={(e) =>
                  setLayout(
                    "copies",
                    Math.max(
                      1,
                      Math.min(5, Number(e.target.value) || 1),
                    ),
                  )
                }
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-semibold">Campos visibles</p>
            {(
              [
                ["showBranch", "Mostrar sucursal"],
                ["showCashier", "Mostrar cajero"],
                ["showCustomer", "Mostrar cliente"],
                ["showSku", "Mostrar SKU"],
                ["showDiscounts", "Mostrar descuentos"],
                ["showTaxes", "Mostrar impuestos"],
                ["showCashReceived", "Mostrar efectivo recibido"],
                ["showChange", "Mostrar cambio"],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3"
              >
                <Label className="font-normal">{label}</Label>
                <Switch
                  checked={form.layout[key]}
                  onCheckedChange={(v) => setLayout(key, v)}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="min-h-11 flex-1"
              disabled={!branchId || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Guardando…" : "Guardar ticket"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={printing}
              onClick={printTest}
            >
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Imprimiendo…" : "Imprimir ticket de prueba"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            La configuración se guarda en la tabla{" "}
            <code className="rounded bg-muted px-1">settings</code>{" "}
            de la sucursal activa. No requiere migraciones nuevas.
          </p>
        </div>

        {/* Vista previa */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Eye className="h-4 w-4" />
            Vista previa ({form.layout.paperWidth} mm)
          </div>

          <div
            className="mx-auto rounded-md border bg-white p-3 font-mono text-[11px] leading-relaxed text-black shadow-sm"
            style={{ width: paperWidthPx, maxWidth: "100%" }}
          >
            <div className="text-center">
              <p className="text-sm font-bold">
                {form.company_name || "Lula Shop"}
              </p>
              {form.layout.showBranch && (
                <p>{branchName}</p>
              )}
              {form.company_address.trim() && (
                <p className="text-[10px] text-gray-700">
                  {form.company_address}
                </p>
              )}
              {form.company_phone.trim() && (
                <p className="text-[10px] text-gray-700">
                  Tel: {form.company_phone}
                </p>
              )}
            </div>

            <div className="my-2 border-t border-dashed border-gray-400" />

            <p>Fecha: {previewTicket.date}</p>
            <p>Folio: {previewTicket.folio}</p>
            {form.layout.showCashier && (
              <p>Cajero: {previewTicket.cashierName}</p>
            )}
            {form.layout.showCustomer && (
              <p>Cliente: {previewTicket.customerName}</p>
            )}

            <div className="my-2 border-t border-dashed border-gray-400" />

            {previewTicket.lines.map((line, i) => (
              <div key={i} className="mb-1">
                <div className="flex justify-between gap-2">
                  <span>
                    {line.quantity} x {line.name}
                    {form.layout.showSku ? " [SKU]" : ""}
                  </span>
                  <span>{money(line.total)}</span>
                </div>
                {form.layout.showDiscounts &&
                  line.discount != null &&
                  line.discount > 0 && (
                    <p className="text-[10px] text-gray-600">
                      Desc. −{money(line.discount)}
                    </p>
                  )}
              </div>
            ))}

            <div className="my-2 border-t border-dashed border-gray-400" />

            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{money(previewTicket.subtotal)}</span>
            </div>
            {form.layout.showTaxes && (
              <div className="flex justify-between">
                <span>Impuestos</span>
                <span>{money(previewTicket.tax)}</span>
              </div>
            )}
            {form.layout.showDiscounts && previewTicket.discount > 0 && (
              <div className="flex justify-between">
                <span>Descuento</span>
                <span>−{money(previewTicket.discount)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between text-sm font-bold">
              <span>TOTAL</span>
              <span>{money(previewTicket.total)}</span>
            </div>

            <div className="my-2 border-t border-dashed border-gray-400" />

            <p>Pago: Efectivo</p>
            {form.layout.showCashReceived && (
              <div className="flex justify-between">
                <span>Recibido</span>
                <span>{money(previewTicket.cashReceived ?? 0)}</span>
              </div>
            )}
            {form.layout.showChange && (
              <div className="flex justify-between">
                <span>Cambio</span>
                <span>{money(previewTicket.changeGiven ?? 0)}</span>
              </div>
            )}

            {form.ticket_footer.trim() && (
              <>
                <div className="my-2 border-t border-dashed border-gray-400" />
                <p className="text-center">{form.ticket_footer}</p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
