export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n ?? 0));

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—";
