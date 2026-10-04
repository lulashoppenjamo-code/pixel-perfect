/**
 * LULA OS — Impresora térmica Bluetooth
 *
 * Comunicación:
 * - Web Bluetooth
 * - Bluetooth Low Energy / GATT
 * - ESC/POS
 *
 * Comportamiento:
 * - Una sola impresora emparejada para todo el sistema
 * - Se mantiene conectada hasta que el usuario la desconecte
 * - Auto-conexión silenciosa al abrir la app (si ya fue emparejada)
 * - La venta NO depende de la impresora
 */

import type { TicketData } from "@/components/pos/TicketModal";

const DEVICE_NAME_KEY = "lula-printer-device-name";
const AUTO_PRINT_KEY = "lula-printer-auto-print";
const LAYOUT_CACHE_KEY = "lula-ticket-layout-cache";
const TICKET_LOGO_CACHE_KEY = "lula-ticket-logo";

export type TicketPrintLayout = {
  showBranch: boolean;
  showCashier: boolean;
  showCustomer: boolean;
  showSku: boolean;
  showDiscounts: boolean;
  showTaxes: boolean;
  showCashReceived: boolean;
  showChange: boolean;
  paperWidth: 58 | 80;
  copies: number;
};

export const DEFAULT_TICKET_LAYOUT: TicketPrintLayout = {
  showBranch: true,
  showCashier: true,
  showCustomer: true,
  showSku: false,
  showDiscounts: true,
  showTaxes: true,
  showCashReceived: true,
  showChange: true,
  paperWidth: 58,
  copies: 1,
};

type BluetoothCharacteristic = {
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
  };
  writeValue: (value: Uint8Array) => Promise<void>;
  writeValueWithoutResponse: (value: Uint8Array) => Promise<void>;
};

type BluetoothGATTService = {
  getCharacteristics: () => Promise<BluetoothCharacteristic[]>;
};

type BluetoothGATTServer = {
  connected: boolean;
  connect: () => Promise<BluetoothGATTServer>;
  disconnect: () => void;
  getPrimaryServices: () => Promise<BluetoothGATTService[]>;
};

type BluetoothDevice = {
  name?: string | null;
  gatt?: BluetoothGATTServer | null;
  addEventListener?: (type: string, listener: () => void) => void;
};

type BluetoothApi = {
  requestDevice: (options: {
    acceptAllDevices: boolean;
    optionalServices?: string[];
  }) => Promise<BluetoothDevice>;
  getDevices?: () => Promise<BluetoothDevice[]>;
};

type PrinterConnection = {
  device: BluetoothDevice;
  characteristic: BluetoothCharacteristic;
};

/** Conexión activa en memoria (se mantiene hasta desconectar manualmente) */
let activeConnection: PrinterConnection | null = null;

const OPTIONAL_SERVICES = [
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "00001101-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "000018f1-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

function bluetoothSupported() {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

function getBluetooth(): BluetoothApi {
  if (!bluetoothSupported()) {
    throw new Error(
      "Este dispositivo o navegador no permite Bluetooth. Usa Chrome/Edge y una impresora BLE compatible.",
    );
  }
  return (navigator as Navigator & { bluetooth: BluetoothApi }).bluetooth;
}

function encode(text: string) {
  return new TextEncoder().encode(text);
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function command(...bytes: number[]) {
  return new Uint8Array(bytes);
}

function center() {
  return command(0x1b, 0x61, 0x01);
}

function left() {
  return command(0x1b, 0x61, 0x00);
}

function bold(enabled: boolean) {
  return command(0x1b, 0x45, enabled ? 0x01 : 0x00);
}

function doubleSize(enabled: boolean) {
  return command(0x1d, 0x21, enabled ? 0x11 : 0x00);
}

function cutPaper() {
  return command(0x1d, 0x56, 0x00);
}

function moneyValue(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function lineSeparator(width: number) {
  return "-".repeat(width);
}

function fit(text: string, width: number) {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function twoColumns(leftText: string, rightText: string, width: number) {
  const right = rightText.length;
  const available = Math.max(1, width - right - 1);
  return (
    fit(leftText, available) +
    " ".repeat(Math.max(1, width - Math.min(leftText.length, available) - right)) +
    rightText
  );
}

function charsForPaper(paperWidth: 58 | 80): number {
  return paperWidth === 80 ? 48 : 32;
}

export function normalizeTicketLayout(raw: unknown): TicketPrintLayout {
  let obj: Record<string, unknown> = {};

  if (raw == null) return { ...DEFAULT_TICKET_LAYOUT };

  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ...DEFAULT_TICKET_LAYOUT };
    }
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }

  const paper = Number(obj.paperWidth ?? obj.paper_width_mm) === 80 ? 80 : 58;
  const copies = Math.max(
    1,
    Math.min(5, Number(obj.copies) || DEFAULT_TICKET_LAYOUT.copies),
  );

  const bool = (a: unknown, b: unknown, fallback: boolean) => {
    if (typeof a === "boolean") return a;
    if (typeof b === "boolean") return b;
    return fallback;
  };

  return {
    showBranch: bool(obj.showBranch, obj.show_branch, DEFAULT_TICKET_LAYOUT.showBranch),
    showCashier: bool(obj.showCashier, obj.show_cashier, DEFAULT_TICKET_LAYOUT.showCashier),
    showCustomer: bool(obj.showCustomer, obj.show_customer, DEFAULT_TICKET_LAYOUT.showCustomer),
    showSku: bool(obj.showSku, obj.show_sku, DEFAULT_TICKET_LAYOUT.showSku),
    showDiscounts: bool(obj.showDiscounts, obj.show_discounts, DEFAULT_TICKET_LAYOUT.showDiscounts),
    showTaxes: bool(obj.showTaxes, obj.show_tax ?? obj.show_taxes, DEFAULT_TICKET_LAYOUT.showTaxes),
    showCashReceived: bool(
      obj.showCashReceived,
      obj.show_cash_received,
      DEFAULT_TICKET_LAYOUT.showCashReceived,
    ),
    showChange: bool(obj.showChange, obj.show_change, DEFAULT_TICKET_LAYOUT.showChange),
    paperWidth: paper,
    copies,
  };
}

export function cacheTicketLayout(layout: TicketPrintLayout) {
  try {
    localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

export function getCachedTicketLayout(): TicketPrintLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_CACHE_KEY);
    if (!raw) return { ...DEFAULT_TICKET_LAYOUT };
    return normalizeTicketLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TICKET_LAYOUT };
  }
}

function getCachedTicketLogo(): string {
  try {
    return localStorage.getItem(TICKET_LOGO_CACHE_KEY) ?? "";
  } catch {
    return "";
  }
}

async function imageToEscPos(
  dataUrl: string,
  paperWidth: 58 | 80,
): Promise<Uint8Array | null> {
  if (!dataUrl || typeof document === "undefined") return null;

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("No se pudo cargar el logo para impresión."));
    });
    image.src = dataUrl;
    await loaded;

    const maxWidth = paperWidth === 80 ? 560 : 384;
    const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const maxHeight = paperWidth === 80 ? 180 : 140;
    const finalScale = Math.min(1, maxHeight / Math.max(1, height));
    const finalWidth = Math.max(1, Math.round(width * finalScale));
    const finalHeight = Math.max(1, Math.round(height * finalScale));

    const canvas = document.createElement("canvas");
    canvas.width = finalWidth;
    canvas.height = finalHeight;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, finalWidth, finalHeight);
    context.drawImage(image, 0, 0, finalWidth, finalHeight);

    const pixels = context.getImageData(0, 0, finalWidth, finalHeight).data;
    const widthBytes = Math.ceil(finalWidth / 8);
    const raster = new Uint8Array(widthBytes * finalHeight);

    for (let y = 0; y < finalHeight; y += 1) {
      for (let x = 0; x < finalWidth; x += 1) {
        const pixelIndex = (y * finalWidth + x) * 4;
        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        const alpha = pixels[pixelIndex + 3];
        if (alpha < 40) continue;

        const gray = 0.299 * red + 0.587 * green + 0.114 * blue;
        if (gray < 185) {
          const byteIndex = y * widthBytes + Math.floor(x / 8);
          const bit = 7 - (x % 8);
          raster[byteIndex] |= 1 << bit;
        }
      }
    }

    const header = command(
      0x1d,
      0x76,
      0x30,
      0x00,
      widthBytes & 0xff,
      (widthBytes >> 8) & 0xff,
      finalHeight & 0xff,
      (finalHeight >> 8) & 0xff,
    );

    return concatBytes(center(), header, raster, encode("\n"), left());
  } catch (error) {
    console.error("No se pudo convertir el logo para ESC/POS:", error);
    return null;
  }
}

async function buildTicketText(
  ticket: TicketData,
  layout: TicketPrintLayout,
): Promise<Uint8Array> {
  const width = charsForPaper(layout.paperWidth);
  const chunks: Uint8Array[] = [];

  chunks.push(command(0x1b, 0x40));

  const logo = ticket.logoDataUrl || getCachedTicketLogo();
  if (logo) {
    const logoBytes = await imageToEscPos(logo, layout.paperWidth);
    if (logoBytes) chunks.push(logoBytes);
  }

  chunks.push(center());
  chunks.push(bold(true));
  chunks.push(encode(`${ticket.companyName ?? "Lula Shop"}\n`));
  chunks.push(bold(false));

  if (ticket.companyAddress) {
    const words = ticket.companyAddress.trim().split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).trim().length <= width) {
        currentLine = (currentLine + " " + word).trim();
      } else {
        if (currentLine) chunks.push(encode(`${currentLine}\n`));
        currentLine = word;
      }
    }
    if (currentLine) chunks.push(encode(`${currentLine}\n`));
  }

  if (ticket.companyPhone) {
    chunks.push(encode(`Tel: ${ticket.companyPhone}\n`));
  }

  if (layout.showBranch && ticket.branchName) {
    chunks.push(encode(`${ticket.branchName}\n`));
  }

  chunks.push(encode("\n"));
  chunks.push(left());
  chunks.push(encode(`${ticket.date}\n`));
  chunks.push(encode(`Folio: ${ticket.folio}\n`));

  if (layout.showCashier && ticket.cashierName) {
    chunks.push(encode(`Cajero: ${ticket.cashierName}\n`));
  }
  if (layout.showCustomer && ticket.customerName) {
    chunks.push(encode(`Cliente: ${ticket.customerName}\n`));
  }
  chunks.push(encode(`Pago: ${ticket.paymentMethod}\n`));
  chunks.push(encode(`${lineSeparator(width)}\n`));

  for (const line of ticket.lines) {
    const name =
      layout.showSku && line.sku ? `${line.name} (${line.sku})` : line.name;
    chunks.push(
      encode(
        twoColumns(`${line.quantity} x ${name}`, moneyValue(line.total), width) +
          "\n",
      ),
    );
    if (layout.showDiscounts && line.discount != null && line.discount > 0) {
      chunks.push(
        encode(
          twoColumns("  Descuento", `-${moneyValue(line.discount)}`, width) +
            "\n",
        ),
      );
    }
  }

  chunks.push(encode(`${lineSeparator(width)}\n`));
  chunks.push(encode(twoColumns("Subtotal", moneyValue(ticket.subtotal), width) + "\n"));

  if (layout.showTaxes && ticket.tax > 0) {
    chunks.push(encode(twoColumns("Impuestos", moneyValue(ticket.tax), width) + "\n"));
  }
  if (layout.showDiscounts && ticket.discount > 0) {
    chunks.push(
      encode(twoColumns("Descuento", `-${moneyValue(ticket.discount)}`, width) + "\n"),
    );
  }

  chunks.push(bold(true));
  chunks.push(encode(twoColumns("TOTAL", moneyValue(ticket.total), width) + "\n"));
  chunks.push(bold(false));

  if (layout.showCashReceived && ticket.cashReceived != null) {
    chunks.push(
      encode(twoColumns("Recibido", moneyValue(ticket.cashReceived), width) + "\n"),
    );
  }
  if (layout.showChange && ticket.cashReceived != null) {
    chunks.push(
      encode(twoColumns("Cambio", moneyValue(ticket.changeGiven ?? 0), width) + "\n"),
    );
  }

  chunks.push(encode("\n"));
  chunks.push(center());
  chunks.push(encode(`${ticket.footer ?? "¡Gracias por su compra!"}\n`));
  chunks.push(left());
  chunks.push(encode("\n\n"));
  chunks.push(cutPaper());

  return concatBytes(...chunks);
}

async function findWritableCharacteristic(device: BluetoothDevice) {
  if (!device.gatt) {
    throw new Error(
      "La impresora no expone GATT. Puede ser Bluetooth clásico (SPP), incompatible con Web Bluetooth.",
    );
  }

  const server = device.gatt.connected
    ? device.gatt
    : await device.gatt.connect();

  const services = await server.getPrimaryServices();

  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const characteristic of characteristics) {
      if (
        characteristic.properties.writeWithoutResponse ||
        characteristic.properties.write
      ) {
        return characteristic;
      }
    }
  }

  throw new Error(
    "No encontré un canal de escritura en la impresora. Verifica que sea BLE/GATT.",
  );
}

function bindDisconnectListener(device: BluetoothDevice) {
  try {
    device.addEventListener?.("gattserverdisconnected", () => {
      // No borramos activeConnection: al imprimir intentamos reconectar el mismo device
      console.warn(
        "Impresora Bluetooth desconectada temporalmente. Se intentará reconectar al imprimir.",
      );
    });
  } catch {
    // ignore
  }
}

/** Emparejar impresora (solo cuando el usuario lo pide) */
export async function connectBluetoothPrinter() {
  const bluetooth = getBluetooth();

  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: OPTIONAL_SERVICES,
  });

  const characteristic = await findWritableCharacteristic(device);
  activeConnection = { device, characteristic };
  bindDisconnectListener(device);

  localStorage.setItem(DEVICE_NAME_KEY, device.name ?? "Impresora Bluetooth");

  return { name: device.name ?? "Impresora Bluetooth" };
}

/**
 * Reconecta sin mostrar selector si es posible.
 * NO lanza error si el navegador no tiene getDevices.
 */
export async function reconnectBluetoothPrinter() {
  // 1) Ya conectada
  if (activeConnection?.device.gatt?.connected) {
    return {
      name: activeConnection.device.name ?? "Impresora Bluetooth",
    };
  }

  // 2) Mismo device de esta sesión: reabrir GATT
  if (activeConnection?.device?.gatt) {
    try {
      await activeConnection.device.gatt.connect();
      const characteristic = await findWritableCharacteristic(
        activeConnection.device,
      );
      activeConnection = {
        device: activeConnection.device,
        characteristic,
      };
      return {
        name: activeConnection.device.name ?? "Impresora Bluetooth",
      };
    } catch (e) {
      console.warn("No se pudo reconectar el device en memoria:", e);
    }
  }

  // 3) getDevices (si el navegador lo soporta)
  const bluetooth = getBluetooth();
  if (typeof bluetooth.getDevices === "function") {
    try {
      const devices = await bluetooth.getDevices();
      const savedName = localStorage.getItem(DEVICE_NAME_KEY);

      const device =
        devices.find((d) => savedName && d.name === savedName) ?? devices[0];

      if (device) {
        const characteristic = await findWritableCharacteristic(device);
        activeConnection = { device, characteristic };
        bindDisconnectListener(device);
        localStorage.setItem(
          DEVICE_NAME_KEY,
          device.name ?? "Impresora Bluetooth",
        );
        return { name: device.name ?? "Impresora Bluetooth" };
      }
    } catch (e) {
      console.warn("getDevices falló:", e);
    }
  }

  // 4) No hay forma automática → null (NO error rojo)
  return null;
}

/**
 * Conexión silenciosa en segundo plano.
 * No muestra errores ni selector.
 * Solo funciona si la impresora ya fue emparejada antes.
 */
export async function autoConnectBluetoothPrinter(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
      return false;
    }

    if (activeConnection?.device.gatt?.connected) {
      return true;
    }

    const result = await reconnectBluetoothPrinter();
    return Boolean(result && activeConnection?.device.gatt?.connected);
  } catch (e) {
    console.warn("Auto-conexión Bluetooth:", e);
    return false;
  }
}

/** Solo el usuario desconecta */
export function disconnectBluetoothPrinter() {
  try {
    activeConnection?.device.gatt?.disconnect();
  } catch {
    // ignore
  }
  activeConnection = null;
}

export function getBluetoothPrinterName() {
  if (activeConnection?.device) {
    return activeConnection.device.name ?? "Impresora Bluetooth";
  }
  return localStorage.getItem(DEVICE_NAME_KEY);
}

export function isBluetoothPrinterConnected() {
  return Boolean(activeConnection?.device.gatt?.connected);
}

async function writeInChunks(
  characteristic: BluetoothCharacteristic,
  data: Uint8Array,
) {
  const chunkSize = 180;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, Math.min(offset + chunkSize, data.length));
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 8));
  }
}

/** Garantiza conexión; si no hay ninguna, pide emparejar */
async function ensurePrinterConnected() {
  if (activeConnection?.device.gatt?.connected) {
    return activeConnection;
  }

  const reconnected = await reconnectBluetoothPrinter();
  if (reconnected && activeConnection?.device.gatt?.connected) {
    return activeConnection;
  }

  // Último recurso: pedir al usuario emparejar
  const paired = await connectBluetoothPrinter();
  if (!paired || !activeConnection) {
    throw new Error(
      "No se pudo conectar la impresora Bluetooth. Emparéjala desde Ajustes.",
    );
  }
  return activeConnection;
}

/** Imprime bytes ESC/POS (tickets, cortes, reportes) */
export async function printRawBluetooth(data: Uint8Array) {
  const connection = await ensurePrinterConnected();
  await writeInChunks(connection.characteristic, data);
}

/** Imprime texto plano (ideal para corte de caja) */
export async function printTextBluetooth(text: string) {
  const connection = await ensurePrinterConnected();
  const data = concatBytes(
    command(0x1b, 0x40),
    left(),
    encode(text.endsWith("\n") ? text : `${text}\n`),
    encode("\n\n"),
    cutPaper(),
  );
  await writeInChunks(connection.characteristic, data);
}

export async function printTicketBluetooth(
  ticket: TicketData,
  layoutOverride?: Partial<TicketPrintLayout>,
) {
  const connection = await ensurePrinterConnected();

  const layout: TicketPrintLayout = {
    ...getCachedTicketLayout(),
    ...layoutOverride,
  };

  const data = await buildTicketText(ticket, layout);
  const copies = Math.max(1, Math.min(5, layout.copies || 1));

  for (let i = 0; i < copies; i += 1) {
    await writeInChunks(connection.characteristic, data);
    if (i < copies - 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

export function setBluetoothAutoPrint(enabled: boolean) {
  localStorage.setItem(AUTO_PRINT_KEY, enabled ? "true" : "false");
}

export function getBluetoothAutoPrint() {
  return localStorage.getItem(AUTO_PRINT_KEY) === "true";
}

export async function printTestTicket(
  layoutOverride?: Partial<TicketPrintLayout>,
) {
  const layout: TicketPrintLayout = {
    ...getCachedTicketLayout(),
    ...layoutOverride,
  };

  const ticket: TicketData = {
    companyName: "Lula Shop",
    logoDataUrl: getCachedTicketLogo() || undefined,
    branchName: layout.showBranch ? "Prueba de impresión" : undefined,
    folio: "TEST",
    date: new Date().toLocaleString("es-MX"),
    cashierName: layout.showCashier ? "Sistema" : undefined,
    customerName: layout.showCustomer ? "Cliente de prueba" : undefined,
    paymentMethod: "Efectivo",
    lines: [
      {
        name: "Ticket de prueba",
        quantity: 1,
        unit_price: 10,
        discount: 0,
        total: 10,
      },
    ],
    subtotal: 10,
    tax: 0,
    discount: 0,
    total: 10,
    cashReceived: layout.showCashReceived ? 20 : null,
    changeGiven: layout.showChange ? 10 : null,
    footer: "Impresora configurada correctamente.",
  };

  await printTicketBluetooth(ticket, layout);
}
