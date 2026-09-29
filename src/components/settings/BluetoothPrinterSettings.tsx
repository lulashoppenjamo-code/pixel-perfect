import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bluetooth,
  CheckCircle2,
  Printer,
  RefreshCw,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  getBluetoothAutoPrint,
  getBluetoothPrinterName,
  isBluetoothPrinterConnected,
  printTestTicket,
  setBluetoothAutoPrint,
} from "@/lib/bluetoothPrinter";

export function BluetoothPrinterSettings() {
  const [
    printerName,
    setPrinterName,
  ] = useState<string | null>(null);

  const [
    connected,
    setConnected,
  ] = useState(false);

  const [
    autoPrint,
    setAutoPrint,
  ] = useState(false);

  const [
    loading,
    setLoading,
  ] = useState(false);

  useEffect(() => {
    setPrinterName(
      getBluetoothPrinterName(),
    );

    setConnected(
      isBluetoothPrinterConnected(),
    );

    setAutoPrint(
      getBluetoothAutoPrint(),
    );
  }, []);

  const connect = async () => {
    setLoading(true);

    try {
      const result =
        await connectBluetoothPrinter();

      setPrinterName(result.name);
      setConnected(true);

      toast.success(
        `Impresora conectada: ${result.name}`,
      );
    } catch (error) {
      console.error(
        "Bluetooth printer:",
        error,
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo conectar la impresora.",
      );
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    disconnectBluetoothPrinter();

    setConnected(false);

    toast.success(
      "Impresora desconectada.",
    );
  };

  const test = async () => {
    setLoading(true);

    try {
      await printTestTicket();

      toast.success(
        "Ticket de prueba enviado.",
      );
    } catch (error) {
      console.error(
        "Printer test:",
        error,
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo imprimir.",
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleAutoPrint = (
    value: boolean,
  ) => {
    setAutoPrint(value);

    setBluetoothAutoPrint(value);

    toast.success(
      value
        ? "La impresión automática quedó activada."
        : "La impresión automática quedó desactivada.",
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" />
          Impresora Bluetooth
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Bluetooth className="h-5 w-5 text-primary" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {printerName ??
                  "Ninguna impresora configurada"}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {connected
                  ? "Conectada y lista para imprimir."
                  : printerName
                    ? "Configurada, pero actualmente desconectada."
                    : "Selecciona una impresora térmica Bluetooth."}
              </p>
            </div>

            {connected && (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={connect}
            disabled={loading}
            className="min-h-11 flex-1"
          >
            {loading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Conectando...
              </>
            ) : (
              <>
                <Bluetooth className="mr-2 h-4 w-4" />
                {printerName
                  ? "Cambiar impresora"
                  : "Conectar impresora"}
              </>
            )}
          </Button>

          {connected && (
            <Button
              type="button"
              variant="outline"
              onClick={disconnect}
              disabled={loading}
              className="min-h-11"
            >
              <Unplug className="mr-2 h-4 w-4" />
              Desconectar
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={test}
            disabled={loading || !printerName}
            className="min-h-11"
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir prueba
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div>
            <Label className="text-sm font-semibold">
              Imprimir automáticamente
            </Label>

            <p className="mt-1 text-xs text-muted-foreground">
              Después de cobrar una venta, Lula OS
              enviará automáticamente el ticket a la
              impresora configurada.
            </p>
          </div>

          <Switch
            checked={autoPrint}
            onCheckedChange={
              toggleAutoPrint
            }
          />
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          La impresión es independiente del cobro.
          Si la impresora está apagada, pierde la
          conexión o no acepta el formato, la venta
          permanece registrada y podrás imprimir el
          ticket nuevamente.
        </div>
      </CardContent>
    </Card>
  );
}