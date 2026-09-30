/**
 * Tipos locales para Web Bluetooth.
 *
 * TypeScript 5.8 no incluye las interfaces Web Bluetooth en
 * lib.dom.d.ts de este proyecto. No usamos los tipos globales
 * Bluetooth* para evitar que el build/typecheck falle.
 */

type BluetoothCharacteristic = {
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
  };

  writeValue: (
    value: BufferSource,
  ) => Promise<void>;

  writeValueWithoutResponse: (
    value: BufferSource,
  ) => Promise<void>;
};

type BluetoothGATTService = {
  getCharacteristics: () => Promise<
    BluetoothCharacteristic[]
  >;
};

type BluetoothGATTServer = {
  connected: boolean;

  connect: () => Promise<BluetoothGATTServer>;

  disconnect: () => void;

  getPrimaryServices: () => Promise<
    BluetoothGATTService[]
  >;
};

type BluetoothDevice = {
  name?: string | null;

  gatt?: BluetoothGATTServer | null;
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

let activeConnection: PrinterConnection | null = null;

function bluetoothSupported() {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator
  );
}

function getBluetooth(): BluetoothApi {
  if (!bluetoothSupported()) {
    throw new Error(
      "Este dispositivo o navegador no permite Bluetooth desde la aplicación. Web Bluetooth requiere Chrome/Edge y una impresora BLE/GATT compatible (no Bluetooth clásico/SPP).",
    );
  }

  return (
    navigator as Navigator & {
      bluetooth: BluetoothApi;
    }
  ).bluetooth;
} 