import { expect, test } from "bun:test";
import {
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  printTextBluetooth,
  printTestTicket,
} from "./bluetoothPrinter";

test("restored print functions send text and a test ticket through the connected printer", async () => {
  const writes: Uint8Array[] = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const characteristic = {
    properties: { write: true, writeWithoutResponse: false },
    writeValue: async (value: Uint8Array) => { writes.push(value); },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { bluetooth: { requestDevice: async () => ({
      name: "Test BLE",
      gatt: {
        connected: true,
        disconnect: () => {},
        getPrimaryServices: async () => [{ getCharacteristics: async () => [characteristic] }],
      },
    }) } },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } },
  });
  try {
    await connectBluetoothPrinter();
    await printTextBluetooth("Corte de caja verificado");
    expect(new TextDecoder().decode(Buffer.concat(writes))).toContain("Corte de caja verificado");
    writes.length = 0;
    await printTestTicket();
    expect(new TextDecoder().decode(Buffer.concat(writes))).toContain("PRUEBA");
    expect(writes.some((bytes) => bytes[0] === 0x1b && bytes[1] === 0x70)).toBe(false);
  } finally {
    disconnectBluetoothPrinter();
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});