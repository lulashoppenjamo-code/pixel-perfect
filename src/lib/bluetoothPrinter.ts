/**
 * LULA OS — Impresora térmica Bluetooth
 *
 * Comunicación:
 * - Web Bluetooth
 * - Bluetooth Low Energy / GATT
 * - ESC/POS
 *
 * IMPORTANTE:
 * La venta NO depende de la impresora.
 * Si imprimir falla, la venta ya quedó registrada.
 */

import type { TicketData } from "@/components/pos/TicketModal";

const DEVICE_NAME_KEY = "lula-printer-device-name";
const AUTO_PRINT_KEY = "lula-printer-auto-print";

const DEFAULT_WIDTH = 32;

type BluetoothCharacteristic = BluetoothRemoteGATTCharacteristic;

type PrinterConnection = {
  device: BluetoothDevice;
  characteristic: BluetoothCharacteristic;
};

let activeConnection: PrinterConnection | null = null;

function bluetoothSupported() {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator
  );
}

function getBluetooth(): Bluetooth & {
  getDevices?: () => Promise<BluetoothDevice[]>;
} {
  if (!bluetoothSupported()) {
    throw new Error(
      "Este dispositivo o navegador no permite Bluetooth desde la aplicación.",
    );
  }

  return navigator.bluetooth as Bluetooth & {
    getDevices?: () => Promise<BluetoothDevice[]>;
  };
}

function encode(text: string) {
  return new TextEncoder().encode(text);
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce(
    (sum, part) => sum + part.length,
    0,
  );

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
  return command(
    0x1d,
    0x21,
    enabled ? 0x11 : 0x00,
  );
}

function cutPaper() {
  return command(0x1d, 0x56, 0x00);
}

function moneyValue(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function lineSeparator(width = DEFAULT_WIDTH) {
  return "-".repeat(width);
}

function fit(text: string, width: number) {
  if (text.length <= width) return text;

  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function twoColumns(
  leftText: string,
  rightText: string,
  width = DEFAULT_WIDTH,
) {
  const right = rightText.length;

  const available = Math.max(
    1,
    width - right - 1,
  );

  return (
    fit(leftText, available) +
    " ".repeat(
      Math.max(
        1,
        width -
          Math.min(leftText.length, available) -
          right,
      ),
    ) +
    rightText
  );
}

function buildTicketText(ticket: TicketData) {
  const width = DEFAULT_WIDTH;

  const chunks: Uint8Array[] = [];

  chunks.push(command(0x1b, 0x40));

  chunks.push(center());

  chunks.push(bold(true));
  chunks.push(doubleSize(true));
  chunks.push(
    encode(
      `${ticket.companyName ?? "Lula Shop"}\n`,
    ),
  );
  chunks.push(doubleSize(false));
  chunks.push(bold(false));

  if (ticket.branchName) {
    chunks.push(
      encode(`${ticket.branchName}\n`),
    );
  }

  chunks.push(
    encode(`${ticket.date}\n`),
  );

  chunks.push(
    encode(`Folio: ${ticket.folio}\n`),
  );

  chunks.push(encode("\n"));

  chunks.push(left());

  if (ticket.cashierName) {
    chunks.push(
      encode(
        `Cajero: ${ticket.cashierName}\n`,
      ),
    );
  }

  if (ticket.customerName) {
    chunks.push(
      encode(
        `Cliente: ${ticket.customerName}\n`,
      ),
    );
  }

  chunks.push(
    encode(
      `Pago: ${ticket.paymentMethod}\n`,
    ),
  );

  chunks.push(
    encode(`${lineSeparator(width)}\n`),
  );

  for (const line of ticket.lines) {
    chunks.push(
      encode(
        `${line.quantity} x ${fit(line.name, width)}\n`,
      ),
    );

    chunks.push(
      encode(
        twoColumns(
          "Precio",
          moneyValue(line.total),
          width,
        ) + "\n",
      ),
    );

    if (
      line.discount != null &&
      line.discount > 0
    ) {
      chunks.push(
        encode(
          `Descuento: -${moneyValue(line.discount)}\n`,
        ),
      );
    }
  }

  chunks.push(
    encode(`${lineSeparator(width)}\n`),
  );

  chunks.push(
    encode(
      twoColumns(
        "Subtotal",
        moneyValue(ticket.subtotal),
        width,
      ) + "\n",
    ),
  );

  chunks.push(
    encode(
      twoColumns(
        "Impuestos",
        moneyValue(ticket.tax),
        width,
      ) + "\n",
    ),
  );

  if (ticket.discount > 0) {
    chunks.push(
      encode(
        twoColumns(
          "Descuento",
          `-${moneyValue(ticket.discount)}`,
          width,
        ) + "\n",
      ),
    );
  }

  chunks.push(bold(true));

  chunks.push(
    encode(
      twoColumns(
        "TOTAL",
        moneyValue(ticket.total),
        width,
      ) + "\n",
    ),
  );

  chunks.push(bold(false));

  if (ticket.cashReceived != null) {
    chunks.push(
      encode(
        twoColumns(
          "Recibido",
          moneyValue(ticket.cashReceived),
          width,
        ) + "\n",
      ),
    );

    chunks.push(
      encode(
        twoColumns(
          "Cambio",
          moneyValue(ticket.changeGiven ?? 0),
          width,
        ) + "\n",
      ),
    );
  }

  chunks.push(encode("\n"));

  if (ticket.footer) {
    chunks.push(center());
    chunks.push(
      encode(`${ticket.footer}\n`),
    );
    chunks.push(left());
  }

  chunks.push(encode("\n\n\n"));

  chunks.push(cutPaper());

  return concatBytes(...chunks);
}

async function findWritableCharacteristic(
  device: BluetoothDevice,
) {
  if (!device.gatt) {
    throw new Error(
      "La impresora no expone una conexión GATT.",
    );
  }

  const server = device.gatt.connected
    ? device.gatt
    : await device.gatt.connect();

  const services =
    await server.getPrimaryServices();

  for (const service of services) {
    const characteristics =
      await service.getCharacteristics();

    for (const characteristic of characteristics) {
      const properties =
        characteristic.properties;

      if (
        properties.writeWithoutResponse ||
        properties.write
      ) {
        return characteristic;
      }
    }
  }

  throw new Error(
    "No encontré un canal Bluetooth de escritura en la impresora.",
  );
}

export async function connectBluetoothPrinter() {
  const bluetooth = getBluetooth();

  const device =
    await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [],
    });

  const characteristic =
    await findWritableCharacteristic(
      device,
    );

  activeConnection = {
    device,
    characteristic,
  };

  localStorage.setItem(
    DEVICE_NAME_KEY,
    device.name ?? "Impresora Bluetooth",
  );

  return {
    name:
      device.name ??
      "Impresora Bluetooth",
  };
}

export async function reconnectBluetoothPrinter() {
  const bluetooth = getBluetooth();

  if (!bluetooth.getDevices) {
    throw new Error(
      "Este navegador no permite recuperar automáticamente impresoras Bluetooth.",
    );
  }

  const devices =
    await bluetooth.getDevices();

  const savedName =
    localStorage.getItem(
      DEVICE_NAME_KEY,
    );

  const device =
    devices.find(
      (item) =>
        savedName &&
        item.name === savedName,
    ) ??
    devices[0];

  if (!device) {
    return null;
  }

  const characteristic =
    await findWritableCharacteristic(
      device,
    );

  activeConnection = {
    device,
    characteristic,
  };

  return {
    name:
      device.name ??
      "Impresora Bluetooth",
  };
}

export function disconnectBluetoothPrinter() {
  try {
    activeConnection?.device.gatt?.disconnect();
  } catch {
    // No bloquear la aplicación.
  }

  activeConnection = null;
}

export function getBluetoothPrinterName() {
  if (activeConnection?.device) {
    return (
      activeConnection.device.name ??
      "Impresora Bluetooth"
    );
  }

  return localStorage.getItem(
    DEVICE_NAME_KEY,
  );
}

export function isBluetoothPrinterConnected() {
  return Boolean(
    activeConnection?.device.gatt?.connected,
  );
}

async function writeInChunks(
  characteristic: BluetoothCharacteristic,
  data: Uint8Array,
) {
  const chunkSize = 180;

  for (
    let offset = 0;
    offset < data.length;
    offset += chunkSize
  ) {
    const chunk = data.slice(
      offset,
      Math.min(
        offset + chunkSize,
        data.length,
      ),
    );

    if (
      characteristic.properties
        .writeWithoutResponse
    ) {
      await characteristic.writeValueWithoutResponse(
        chunk,
      );
    } else {
      await characteristic.writeValue(
        chunk,
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 8),
    );
  }
}

export async function printTicketBluetooth(
  ticket: TicketData,
) {
  if (
    !activeConnection ||
    !activeConnection.device.gatt?.connected
  ) {
    await reconnectBluetoothPrinter();
  }

  if (!activeConnection) {
    throw new Error(
      "No hay una impresora Bluetooth configurada.",
    );
  }

  const data =
    buildTicketText(ticket);

  await writeInChunks(
    activeConnection.characteristic,
    data,
  );
}

export function setBluetoothAutoPrint(
  enabled: boolean,
) {
  localStorage.setItem(
    AUTO_PRINT_KEY,
    enabled ? "true" : "false",
  );
}

export function getBluetoothAutoPrint() {
  return (
    localStorage.getItem(
      AUTO_PRINT_KEY,
    ) === "true"
  );
}

export async function printTestTicket() {
  const ticket: TicketData = {
    companyName: "Lula Shop",
    branchName: "Prueba de impresión",
    folio: "TEST",
    date: new Date().toLocaleString(
      "es-MX",
    ),
    cashierName: "Sistema",
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
    cashReceived: 20,
    changeGiven: 10,
    footer:
      "Impresora configurada correctamente.",
  };

  await printTicketBluetooth(
    ticket,
  );
}