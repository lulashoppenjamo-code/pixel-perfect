/**
 * Botón global de conexión rápida y estado de impresora Bluetooth
 * Ruta: src/components/BluetoothPrinterGlobalButton.tsx
 */

import { useState, useEffect } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import {
  connectBluetoothPrinter,
  autoConnectBluetoothPrinter,
  isBluetoothPrinterConnected,
  getBluetoothPrinterName,
} from "@/lib/bluetoothPrinter";

export function BluetoothPrinterGlobalButton() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(null);

  const checkStatus = async () => {
    const isConn = isBluetoothPrinterConnected();
    setConnected(isConn);
    setPrinterName(getBluetoothPrinterName());
  };

  useEffect(() => {
    // Intento de auto-conexión al iniciar la app / recargar página
    let mounted = true;
    async function initConn() {
      setConnecting(true);
      try {
        await autoConnectBluetoothPrinter();
        if (mounted) {
          await checkStatus();
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setConnecting(false);
      }
    }
    void initConn();

    const interval = setInterval(() => {
      if (mounted) void checkStatus();
    }, 4000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleClick = async () => {
    if (connected) {
      toast.info(`Impresora lista: ${printerName ?? "Bluetooth"}`);
      return;
    }

    setConnecting(true);
    try {
      // Intentar reconectar automáticamente primero si ya hay device guardado
      const autoOk = await autoConnectBluetoothPrinter();
      if (autoOk) {
        toast.success("¡Impresora reconectada con éxito!");
        await checkStatus();
        return;
      }

      // Si no hay device previo o falló, solicitar emparejamiento nuevo
      const info = await connectBluetoothPrinter();
      toast.success(`Impresora conectada: ${info.name}`);
      await checkStatus();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo conectar la impresora Bluetooth.",
      );
    } finally {
      setConnecting(false);
    }
  };

  let badgeColor = "bg-red-500";
  let titleText = "Desconectada - Click para conectar";
  if (connecting) {
    badgeColor = "bg-amber-500 animate-pulse";
    titleText = "Intentando conectar...";
  } else if (connected) {
    badgeColor = "bg-emerald-500";
    titleText = `Conectada (${printerName ?? "Impresora"})`;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={connecting}
      title={titleText}
      className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 active:bg-white/30"
    >
      <div className="relative flex items-center justify-center">
        <Printer className="h-4 w-4" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-900 ${badgeColor}`}
        />
      </div>
      <span className="hidden sm:inline truncate max-w-[100px]">
        {connecting ? "Conectando..." : connected ? (printerName || "Lista") : "Conectar"}
      </span>
    </button>
  );
}
