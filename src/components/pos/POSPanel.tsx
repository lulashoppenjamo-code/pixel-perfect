/**
 * Punto de Venta — LULA OS
 * Archivo: src/components/pos/POSPanel.tsx
 *
 * INVENTARIO COMPARTIDO:
 * - El stock operativo viene de shared_inventory.
 * - NO consulta la tabla legacy inventory para determinar existencias.
 * - branchId sigue utilizándose para registrar la venta y la caja.
 * - create_sale() se mantiene como RPC central de venta.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Minus,
  ShoppingCart,
  CreditCard,
  Banknote,
  Smartphone,
  User,
  X,
  Package,
  History,
  Printer,
  Pencil,
  StickyNote,
  Camera,
  CameraOff,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { getSharedInventory } from "@/lib/sharedInventory";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ScrollArea } from "@/components/ui/scroll-area";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  TicketModal,
  type TicketData,
} from "@/components/pos/TicketModal";

import { cn } from "@/lib/utils";

type CartLine = {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  unit_price: number;
  original_price: number;
  quantity: number;
  discount: number;
  tax_rate: number;
  stock: number;
  sku?: string | null;
  barcode?: string | null;
  emoji?: string | null;
};

type PaymentMethod =
  | "cash"
  | "card"
  | "transfer"
  | "credit"
  | "mixed";

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  tax_rate: number;
  emoji: string | null;
  category_id: string | null;
  stock: number;
  has_variants: boolean;
};

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price_override: number | null;
};

type RecentSale = {
  id: string;
  folio: number;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
  customer_id: string | null;
};

export function POSPanel({
  className = "h-[calc(100dvh-3rem)]",
}: {
  className?: string;
}) {
  const { branchId, branches } = useBranch();
  const { profile, user, isManager } = useAuth();
  const qc = useQueryClient();

  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);

  const [method, setMethod] =
    useState<PaymentMethod>("cash");

  const [customerId, setCustomerId] =
    useState<string>("none");

  const [cashReceived, setCashReceived] =
    useState("");

  const [mixedCash, setMixedCash] =
    useState("");

  const [mixedCard, setMixedCard] =
    useState("");

  const [ticketDiscount, setTicketDiscount] =
    useState("0");

  const [saleNotes, setSaleNotes] =
    useState("");

  const [categoryFilter, setCategoryFilter] =
    useState("all");

  const [historyOpen, setHistoryOpen] =
    useState(false);

  const [scannerOpen, setScannerOpen] =
    useState(false);

  const [scannerError, setScannerError] =
    useState<string | null>(null);

  const [variantPickerProduct, setVariantPickerProduct] =
    useState<ProductRow | null>(null);

  const [editLineKey, setEditLineKey] =
    useState<string | null>(null);

  const [editPrice, setEditPrice] =
    useState("");

  const [editDiscount, setEditDiscount] =
    useState("");

  const [ticket, setTicket] =
    useState<TicketData | null>(null);

  const [ticketOpen, setTicketOpen] =
    useState(false);

  const branchName =
    branches.find((b) => b.id === branchId)?.name ?? "";

  /*
   * =========================================================
   * CONFIGURACIÓN DEL POS
   * =========================================================
   */

  const { data: settings } = useQuery({
    queryKey: ["settings-pos"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key, value");

      if (error) throw error;

      const parse = (
        key: string,
        fallback: unknown,
      ) => {
        const raw = (data ?? []).find(
          (row) => row.key === key,
        )?.value;

        if (raw === null || raw === undefined) {
          return fallback;
        }

        if (
          typeof raw === "boolean" ||
          typeof raw === "number"
        ) {
          return raw;
        }

        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }

        return raw;
      };

      return {
        requireOpenCash: Boolean(
          parse(
            "require_open_cash_session",
            true,
          ),
        ),

        blockWithoutStock: Boolean(
          parse(
            "block_sale_without_stock",
            true,
          ),
        ),

        companyName: String(
          parse(
            "company_name",
            "Lula Shop",
          ),
        ),

        ticketFooter: String(
          parse(
            "ticket_footer",
            "¡Gracias por su compra!",
          ),
        ),
      };
    },
  });

  /*
   * =========================================================
   * CAJA ABIERTA
   * =========================================================
   */

  const { data: openSession } = useQuery({
    queryKey: ["open-cash", branchId],
    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select(
          "id, opened_at, opening_amount",
        )
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .maybeSingle();

      if (error) throw error;

      return data;
    },
  });

  /*
   * =========================================================
   * PRODUCTOS + INVENTARIO COMPARTIDO
   *
   * IMPORTANTE:
   * NO usar:
   *
   * .from("inventory")
   * .eq("branch_id", branchId!)
   *
   * El POS utiliza shared_inventory.
   * =========================================================
   */

  const {
    data: products = [],
    isLoading: loadingProducts,
  } = useQuery({
    queryKey: ["pos-products-shared"],

    enabled: !!branchId,

    queryFn: async () => {
      const [
        productsResult,
        sharedInventory,
      ] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id, name, sku, barcode, price, tax_rate, emoji, category_id, has_variants",
          )
          .eq("is_active", true)
          .order("name"),

        getSharedInventory(),
      ]);

      if (productsResult.error) {
        throw productsResult.error;
      }

      const rows = sharedInventory ?? [];

      /*
       * Producto simple:
       * stock de la fila sin variant_id.
       */
      const simpleStock = new Map<
        string,
        number
      >();

      /*
       * Producto con variantes:
       * suma del stock disponible de sus variantes.
       */
      const variantStockByProduct = new Map<
        string,
        number
      >();

      for (const row of rows) {
        const available = Number(
          row.available_stock ?? 0,
        );

        if (!row.variant_id) {
          simpleStock.set(
            row.product_id,
            available,
          );
          continue;
        }

        variantStockByProduct.set(
          row.product_id,
          (variantStockByProduct.get(
            row.product_id,
          ) ?? 0) + available,
        );
      }

      return (
        productsResult.data ?? []
      ).map((product) => {
        const hasVariants = Boolean(
          product.has_variants,
        );

        return {
          ...product,

          price: Number(
            product.price ?? 0,
          ),

          tax_rate: Number(
            product.tax_rate ?? 0,
          ),

          stock: hasVariants
            ? (
                variantStockByProduct.get(
                  product.id,
                ) ?? 0
              )
            : (
                simpleStock.get(
                  product.id,
                ) ?? 0
              ),

          has_variants: hasVariants,
        };
      }) as ProductRow[];
    },
  });

  /*
   * =========================================================
   * INVENTARIO DE VARIANTES
   *
   * También sale de shared_inventory.
   * =========================================================
   */

  const {
    data: variantStockMap = new Map<
      string,
      number
    >(),
  } = useQuery({
    queryKey: [
      "pos-variant-inventory-shared",
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const rows =
        await getSharedInventory();

      const map = new Map<
        string,
        number
      >();

      for (const row of rows) {
        if (!row.variant_id) continue;

        map.set(
          row.variant_id,
          Number(
            row.available_stock ?? 0,
          ),
        );
      }

      return map;
    },
  });

  /*
   * =========================================================
   * VARIANTES
   * =========================================================
   */

  const {
    data: allVariants = [],
  } = useQuery({
    queryKey: ["pos-all-variants"],

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("product_variants")
          .select(
            "id, product_id, name, sku, price_override",
          )
          .order("name");

      if (error) throw error;

      return (
        data ?? []
      ) as VariantRow[];
    },
  });

  const productVariants = useMemo(
    () =>
      allVariants.filter(
        (variant) =>
          variant.product_id ===
          variantPickerProduct?.id,
      ),
    [
      allVariants,
      variantPickerProduct,
    ],
  );

  /*
   * =========================================================
   * CATEGORÍAS
   * =========================================================
   */

  const {
    data: categories = [],
  } = useQuery({
    queryKey: ["pos-categories"],

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("categories")
          .select("id, name")
          .order("name");

      if (error) throw error;

      return data ?? [];
    },
  });

  /*
   * =========================================================
   * CLIENTES
   * =========================================================
   */

  const {
    data: customers = [],
  } = useQuery({
    queryKey: ["pos-customers"],

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("customers")
          .select("id, name")
          .order("name");

      if (error) throw error;

      return data ?? [];
    },
  });

  /*
   * =========================================================
   * HISTORIAL DE VENTAS
   * =========================================================
   */

  const {
    data: recentSales = [],
    refetch: refetchHistory,
  } = useQuery({
    queryKey: [
      "pos-recent-sales",
      branchId,
    ],

    enabled:
      !!branchId &&
      historyOpen,

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sales")
          .select(
            "id, folio, total, payment_method, status, created_at, customer_id",
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          )
          .limit(30);

      if (error) throw error;

      return (
        data ?? []
      ) as RecentSale[];
    },
  });

  /*
   * =========================================================
   * FILTRO DE PRODUCTOS
   * =========================================================
   */

  const filtered = useMemo(() => {
    let list = products;

    if (
      categoryFilter !== "all"
    ) {
      list = list.filter(
        (product) =>
          product.category_id ===
          categoryFilter,
      );
    }

    const q =
      search
        .trim()
        .toLowerCase();

    if (!q) {
      return list;
    }

    const matchingVariantProducts =
      new Set(
        allVariants
          .filter(
            (variant) =>
              (
                variant.sku ?? ""
              )
                .toLowerCase()
                .includes(q) ||
              variant.name
                .toLowerCase()
                .includes(q),
          )
          .map(
            (variant) =>
              variant.product_id,
          ),
      );

    return list.filter(
      (product) =>
        product.name
          .toLowerCase()
          .includes(q) ||
        (
          product.sku ?? ""
        )
          .toLowerCase()
          .includes(q) ||
        (
          product.barcode ?? ""
        )
          .toLowerCase()
          .includes(q) ||
        matchingVariantProducts.has(
          product.id,
        ),
    );
  }, [
    products,
    search,
    categoryFilter,
    allVariants,
  ]);

  /*
   * =========================================================
   * TOTALES
   * =========================================================
   */

  const linesSubtotal =
    cart.reduce(
      (sum, line) =>
        sum +
        line.unit_price *
          line.quantity -
        line.discount,
      0,
    );

  const linesTax =
    cart.reduce(
      (sum, line) => {
        const base =
          line.unit_price *
            line.quantity -
          line.discount;

        return (
          sum +
          base *
            (line.tax_rate || 0)
        );
      },
      0,
    );

  const disc =
    Number(ticketDiscount) || 0;

  const total = Math.max(
    0,
    linesSubtotal +
      linesTax -
      disc,
  );

  const cashNum =
    Number(cashReceived) || 0;

  const change =
    method === "cash"
      ? Math.max(
          0,
          cashNum - total,
        )
      : 0;

  /*
   * =========================================================
   * AGREGAR PRODUCTO SIMPLE
   * =========================================================
   */

  const addProduct = (
    product: ProductRow,
  ) => {
    if (product.has_variants) {
      setVariantPickerProduct(
        product,
      );
      return;
    }

    if (
      settings?.blockWithoutStock &&
      product.stock <= 0
    ) {
      toast.error(
        "Sin stock disponible",
      );
      return;
    }

    setCart((previous) => {
      const index =
        previous.findIndex(
          (line) =>
            line.product_id ===
              product.id &&
            !line.variant_id,
        );

      if (index >= 0) {
        const next = [
          ...previous,
        ];

        const line = {
          ...next[index]!,
        };

        if (
          settings?.blockWithoutStock &&
          line.quantity + 1 >
            product.stock
        ) {
          toast.error(
            "Stock insuficiente",
          );

          return previous;
        }

        line.quantity += 1;
        next[index] = line;

        return next;
      }

      return [
        ...previous,
        {
          key: `${product.id}-${Date.now()}`,

          product_id:
            product.id,

          variant_id: null,

          name:
            product.name,

          unit_price:
            product.price,

          original_price:
            product.price,

          quantity: 1,

          discount: 0,

          tax_rate:
            product.tax_rate,

          stock:
            product.stock,

          sku:
            product.sku,

          barcode:
            product.barcode,

          emoji:
            product.emoji,
        },
      ];
    });

    setSearch("");
    searchRef.current?.focus();
  };

  /*
   * =========================================================
   * AGREGAR VARIANTE
   * =========================================================
   */

  const addVariant = (
    product: ProductRow,
    variant: VariantRow,
  ) => {
    const variantStock =
      variantStockMap.get(
        variant.id,
      ) ?? 0;

    if (
      settings?.blockWithoutStock &&
      variantStock <= 0
    ) {
      toast.error(
        "Sin stock disponible para esta variante",
      );
      return;
    }

    const unitPrice =
      variant.price_override !=
      null
        ? Number(
            variant.price_override,
          )
        : product.price;

    setCart((previous) => {
      const index =
        previous.findIndex(
          (line) =>
            line.product_id ===
              product.id &&
            line.variant_id ===
              variant.id,
        );

      if (index >= 0) {
        const next = [
          ...previous,
        ];

        const line = {
          ...next[index]!,
        };

        if (
          settings?.blockWithoutStock &&
          line.quantity + 1 >
            variantStock
        ) {
          toast.error(
            "Stock insuficiente",
          );

          return previous;
        }

        line.quantity += 1;

        next[index] =
          line;

        return next;
      }

      return [
        ...previous,
        {
          key: `${product.id}-${variant.id}-${Date.now()}`,

          product_id:
            product.id,

          variant_id:
            variant.id,

          name: `${product.name} — ${variant.name}`,

          unit_price:
            unitPrice,

          original_price:
            unitPrice,

          quantity: 1,

          discount: 0,

          tax_rate:
            product.tax_rate,

          stock:
            variantStock,

          sku:
            variant.sku ??
            product.sku,

          barcode:
            product.barcode,

          emoji:
            product.emoji,
        },
      ];
    });

    setVariantPickerProduct(
      null,
    );

    setSearch("");
    searchRef.current?.focus();
  };

  /*
   * =========================================================
   * BUSCAR POR CÓDIGO / SKU / BARCODE
   * =========================================================
   */

  const resolveAndAddByCode = (
    rawCode: string,
  ): boolean => {
    const code =
      rawCode.trim();

    if (!code) {
      return false;
    }

    const variant =
      allVariants.find(
        (item) =>
          item.sku === code,
      );

    if (variant) {
      const parent =
        products.find(
          (product) =>
            product.id ===
            variant.product_id,
        );

      if (parent) {
        addVariant(
          parent,
          variant,
        );

        return true;
      }
    }

    const byBarcode =
      products.find(
        (product) =>
          product.barcode ===
          code,
      );

    const bySku =
      products.find(
        (product) =>
          product.sku === code,
      );

    const target =
      byBarcode ??
      bySku;

    if (target) {
      addProduct(target);
      return true;
    }

    return false;
  };

  const handleSearchKey = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (
      event.key !==
      "Enter"
    ) {
      return;
    }

    event.preventDefault();

    const query =
      search.trim();

    if (!query) {
      return;
    }

    if (
      resolveAndAddByCode(
        query,
      )
    ) {
      return;
    }

    const target =
      filtered[0];

    if (target) {
      addProduct(target);
    }
  };

  /*
   * =========================================================
   * ESCÁNER DE CÁMARA
   * =========================================================
   */

  useEffect(() => {
    if (!scannerOpen) {
      return;
    }

    setScannerError(null);

    const BarcodeDetectorCtor =
      (
        window as unknown as {
          BarcodeDetector?: new (
            options?: {
              formats?: string[];
            },
          ) => {
            detect: (
              source: HTMLVideoElement,
            ) => Promise<
              Array<{
                rawValue: string;
              }>
            >;
          };
        }
      ).BarcodeDetector;

    if (!BarcodeDetectorCtor) {
      setScannerError(
        "Tu navegador no soporta escaneo por cámara. Usa un lector de código o escribe el código.",
      );

      return;
    }

    let cancelled = false;

    const detector =
      new BarcodeDetectorCtor({
        formats: [
          "ean_13",
          "ean_8",
          "upc_a",
          "upc_e",
          "code_128",
          "code_39",
          "qr_code",
        ],
      });

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode:
            "environment",
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop(),
            );

          return;
        }

        streamRef.current =
          stream;

        if (
          videoRef.current
        ) {
          videoRef.current.srcObject =
            stream;

          void videoRef.current.play();
        }

        const tick =
          async () => {
            if (
              cancelled ||
              !videoRef.current
            ) {
              return;
            }

            try {
              const codes =
                await detector.detect(
                  videoRef.current,
                );

              if (
                codes.length >
                0
              ) {
                const code =
                  codes[0]!
                    .rawValue;

                const found =
                  resolveAndAddByCode(
                    code,
                  );

                if (found) {
                  toast.success(
                    `Escaneado: ${code}`,
                  );

                  setScannerOpen(
                    false,
                  );

                  return;
                }
              }
            } catch {
              // Continúa escaneando.
            }

            scanRafRef.current =
              requestAnimationFrame(
                tick,
              );
          };

        scanRafRef.current =
          requestAnimationFrame(
            tick,
          );
      })
      .catch(() => {
        if (!cancelled) {
          setScannerError(
            "No se pudo acceder a la cámara. Revisa los permisos del navegador.",
          );
        }
      });

    return () => {
      cancelled = true;

      if (
        scanRafRef.current
      ) {
        cancelAnimationFrame(
          scanRafRef.current,
        );
      }

      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop(),
        );

      streamRef.current =
        null;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  /*
   * =========================================================
   * CANTIDADES
   * =========================================================
   */

  const updateQty = (
    key: string,
    delta: number,
  ) => {
    setCart((previous) =>
      previous
        .map((line) => {
          if (
            line.key !== key
          ) {
            return line;
          }

          const nextQty =
            Math.round(
              (
                line.quantity +
                delta
              ) * 1000,
            ) / 1000;

          if (
            nextQty <= 0
          ) {
            return null;
          }

          if (
            settings?.blockWithoutStock &&
            nextQty >
              line.stock
          ) {
            toast.error(
              "Stock insuficiente",
            );

            return line;
          }

          return {
            ...line,
            quantity:
              nextQty,
          };
        })
        .filter(
          Boolean,
        ) as CartLine[],
    );
  };

  const setQtyDirect = (
    key: string,
    value: string,
  ) => {
    const quantity =
      Number(value);

    if (
      Number.isNaN(
        quantity,
      ) ||
      quantity < 0
    ) {
      return;
    }

    setCart((previous) =>
      previous
        .map((line) => {
          if (
            line.key !== key
          ) {
            return line;
          }

          if (
            quantity === 0
          ) {
            return null;
          }

          if (
            settings?.blockWithoutStock &&
            quantity >
              line.stock
          ) {
            toast.error(
              "Stock insuficiente",
            );

            return line;
          }

          return {
            ...line,
            quantity:
              Math.round(
                quantity *
                  1000,
              ) / 1000,
          };
        })
        .filter(
          Boolean,
        ) as CartLine[],
    );
  };

  const removeLine = (
    key: string,
  ) => {
    setCart((previous) =>
      previous.filter(
        (line) =>
          line.key !== key,
      ),
    );
  };

  /*
   * =========================================================
   * EDICIÓN DE LÍNEA
   * =========================================================
   */

  const openEditLine = (
    line: CartLine,
  ) => {
    setEditLineKey(
      line.key,
    );

    setEditPrice(
      String(
        line.unit_price,
      ),
    );

    setEditDiscount(
      String(
        line.discount,
      ),
    );
  };

  const applyEditLine = () => {
    if (!editLineKey) {
      return;
    }

    const price =
      Number(editPrice);

    const discount =
      Number(
        editDiscount,
      ) || 0;

    if (
      Number.isNaN(price) ||
      price < 0
    ) {
      toast.error(
        "Precio inválido",
      );

      return;
    }

    if (
      discount < 0
    ) {
      toast.error(
        "Descuento inválido",
      );

      return;
    }

    setCart((previous) =>
      previous.map(
        (line) => {
          if (
            line.key !==
            editLineKey
          ) {
            return line;
          }

          const nextPrice =
            isManager
              ? price
              : line.unit_price;

          if (
            !isManager &&
            price !==
              line.unit_price
          ) {
            toast.error(
              "Sin permiso para cambiar precio",
            );
          }

          return {
            ...line,

            unit_price:
              nextPrice,

            discount:
              Math.min(
                discount,
                nextPrice *
                  line.quantity,
              ),
          };
        },
      ),
    );

    setEditLineKey(null);
  };

  /*
   * =========================================================
   * COBRO
   * =========================================================
   *
   * IMPORTANTE:
   * create_sale() permanece como RPC central.
   *
   * El RPC ya fue puenteado para descontar
   * shared_inventory.
   * =========================================================
   */

  const checkout = useMutation({
    mutationFn:
      async () => {
        if (!branchId) {
          throw new Error(
            "Sin sucursal",
          );
        }

        if (!cart.length) {
          throw new Error(
            "Carrito vacío",
          );
        }

        if (
          settings?.requireOpenCash &&
          !openSession
        ) {
          throw new Error(
            "Debes abrir caja antes de vender",
          );
        }

        if (
          method === "cash" &&
          cashNum > 0 &&
          cashNum < total
        ) {
          throw new Error(
            "El efectivo recibido es menor al total",
          );
        }

        if (
          method === "mixed"
        ) {
          const mixedCashValue =
            Number(
              mixedCash,
            ) || 0;

          const mixedCardValue =
            Number(
              mixedCard,
            ) || 0;

          if (
            mixedCashValue +
              mixedCardValue <
            total - 0.01
          ) {
            throw new Error(
              "La suma de pagos mixtos debe cubrir el total",
            );
          }
        }

        if (
          method === "credit" &&
          customerId ===
            "none"
        ) {
          throw new Error(
            "Selecciona un cliente para venta a crédito",
          );
        }

        const items =
          cart.map(
            (line) => ({
              product_id:
                line.product_id,

              variant_id:
                line.variant_id,

              name:
                line.name,

              unit_price:
                line.unit_price,

              quantity:
                line.quantity,

              discount:
                line.discount,
            }),
          );

        const {
          data,
          error,
        } =
          await supabase.rpc(
            "create_sale",
            {
              _branch_id:
                branchId,

              _items:
                items,

              _payment_method:
                method,

              _discount:
                disc,

              ...(customerId !==
              "none"
                ? {
                    _customer_id:
                      customerId,
                  }
                : {}),

              ...(openSession?.id
                ? {
                    _cash_session_id:
                      openSession.id,
                  }
                : {}),

              ...(method ===
              "cash"
                ? {
                    _cash_received:
                      cashNum ||
                      total,
                  }
                : method ===
                      "mixed" &&
                    Number(
                      mixedCash,
                    )
                  ? {
                      _cash_received:
                        Number(
                          mixedCash,
                        ),
                    }
                  : {}),
            },
          );

        if (error) {
          throw error;
        }

        return data as {
          folio: number;
          id?: string;
        };
      },

    onSuccess:
      (sale) => {
        const customerName =
          customerId !==
          "none"
            ? customers.find(
                (customer) =>
                  customer.id ===
                  customerId,
              )?.name
            : undefined;

        const paymentLabel =
          method === "mixed"
            ? `Mixto (Efectivo ${money(
                Number(
                  mixedCash,
                ) || 0,
              )} + Tarjeta ${money(
                Number(
                  mixedCard,
                ) || 0,
              )})`
            : method;

        setTicket({
          companyName:
            settings?.companyName,

          branchName,

          folio:
            sale.folio,

          date:
            new Date().toLocaleString(
              "es-MX",
            ),

          cashierName:
            profile?.full_name ??
            user?.email ??
            "",

          customerName,

          paymentMethod:
            paymentLabel,

          lines:
            cart.map(
              (line) => ({
                name:
                  line.name,

                quantity:
                  line.quantity,

                unit_price:
                  line.unit_price,

                discount:
                  line.discount,

                total:
                  line.unit_price *
                    line.quantity -
                  line.discount,
              }),
            ),

          subtotal:
            linesSubtotal,

          tax:
            linesTax,

          discount:
            disc,

          total,

          cashReceived:
            method === "cash"
              ? cashNum ||
                total
              : method ===
                  "mixed"
                ? Number(
                    mixedCash,
                  ) || null
                : null,

          changeGiven:
            method === "cash"
              ? change
              : null,

          footer:
            saleNotes
              ? `${settings?.ticketFooter ?? ""}\nNotas: ${saleNotes}`.trim()
              : settings?.ticketFooter,
        });

        setTicketOpen(
          true,
        );

        setCart([]);

        setCashReceived(
          "",
        );

        setMixedCash(
          "",
        );

        setMixedCard(
          "",
        );

        setTicketDiscount(
          "0",
        );

        setSaleNotes(
          "",
        );

        setCustomerId(
          "none",
        );

        setMethod(
          "cash",
        );

        /*
         * INVALIDACIONES NUEVAS:
         * El POS ya no refresca inventory por sucursal.
         */

        void qc.invalidateQueries(
          {
            queryKey: [
              "pos-products-shared",
            ],
          },
        );

        void qc.invalidateQueries(
          {
            queryKey: [
              "pos-variant-inventory-shared",
            ],
          },
        );

        void qc.invalidateQueries(
          {
            queryKey: [
              "open-cash",
            ],
          },
        );

        void qc.invalidateQueries(
          {
            queryKey: [
              "pos-recent-sales",
            ],
          },
        );

        void qc.invalidateQueries(
          {
            queryKey: [
              "shared-inventory",
            ],
          },
        );

        toast.success(
          `Venta #${sale.folio} registrada`,
        );

        searchRef.current?.focus();
      },

    onError:
      (error: Error) => {
        toast.error(
          error.message ||
            "Error al cobrar",
        );
      },
  });

  /*
   * =========================================================
   * REIMPRESIÓN
   * =========================================================
   */

  const reprintSale =
    useMutation({
      mutationFn:
        async (
          saleId: string,
        ) => {
          const {
            data: sale,
            error,
          } =
            await supabase
              .from("sales")
              .select(
                "id, folio, total, subtotal, tax, discount, payment_method, cash_received, change_given, created_at, customer_id, cashier_id",
              )
              .eq(
                "id",
                saleId,
              )
              .single();

          if (error) {
            throw error;
          }

          const {
            data: items,
            error: itemsError,
          } =
            await supabase
              .from(
                "sale_items",
              )
              .select(
                "name_snapshot, quantity, unit_price, discount, total",
              )
              .eq(
                "sale_id",
                saleId,
              );

          if (itemsError) {
            throw itemsError;
          }

          let customerName:
            | string
            | undefined;

          if (
            sale.customer_id
          ) {
            const {
              data: customer,
            } =
              await supabase
                .from(
                  "customers",
                )
                .select(
                  "name",
                )
                .eq(
                  "id",
                  sale.customer_id,
                )
                .maybeSingle();

            customerName =
              customer?.name;
          }

          return {
            sale,
            items:
              items ?? [],
            customerName,
          };
        },

      onSuccess:
        ({
          sale,
          items,
          customerName,
        }) => {
          setTicket({
            companyName:
              settings?.companyName,

            branchName,

            folio:
              sale.folio,

            date:
              new Date(
                sale.created_at,
              ).toLocaleString(
                "es-MX",
              ),

            cashierName:
              profile?.full_name ??
              user?.email ??
              "",

            customerName,

            paymentMethod:
              sale.payment_method,

            lines:
              items.map(
                (line) => ({
                  name:
                    line.name_snapshot,

                  quantity:
                    Number(
                      line.quantity,
                    ),

                  unit_price:
                    Number(
                      line.unit_price,
                    ),

                  discount:
                    Number(
                      line.discount,
                    ),

                  total:
                    Number(
                      line.total,
                    ),
                }),
              ),

            subtotal:
              Number(
                sale.subtotal,
              ),

            tax:
              Number(
                sale.tax,
              ),

            discount:
              Number(
                sale.discount,
              ),

            total:
              Number(
                sale.total,
              ),

            cashReceived:
              sale.cash_received !=
              null
                ? Number(
                    sale.cash_received,
                  )
                : null,

            changeGiven:
              sale.change_given !=
              null
                ? Number(
                    sale.change_given,
                  )
                : null,

            footer:
              settings?.ticketFooter,
          });

          setHistoryOpen(
            false,
          );

          setTicketOpen(
            true,
          );
        },

      onError:
        (error: Error) => {
          toast.error(
            error.message ||
              "No se pudo reimprimir",
          );
        },
    });

  /*
   * =========================================================
   * AUTOFOCUS
   * =========================================================
   */

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const canSell =
    !settings?.requireOpenCash ||
    !!openSession;

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <div
      className={cn(
        "flex flex-col bg-[#f4f6fb] lg:flex-row",
        className,
      )}
    >
      {/* =====================================================
          IZQUIERDA — PRODUCTOS
          ===================================================== */}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}

        <div className="flex items-center justify-between bg-[#4169e2] px-3 py-2.5 text-white sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">
              {branchName ||
                "Counter"}
            </p>

            <p className="text-[10px] opacity-80">
              {canSell
                ? "Listo para vender"
                : "Caja cerrada"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-white hover:bg-white/15"
              title="Historial"
              onClick={() => {
                setHistoryOpen(
                  true,
                );

                void refetchHistory();
              }}
            >
              <History className="h-4 w-4" />
            </Button>

            {!canSell && (
              <span className="rounded-full bg-red-500/90 px-2.5 py-1 text-[10px] font-bold">
                Caja cerrada
              </span>
            )}
          </div>
        </div>

        {/* Buscador */}

        <div className="border-b border-[#e2e8f0] bg-white px-3 py-2.5 sm:px-4">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b8]" />

              <Input
                ref={searchRef}
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                onKeyDown={
                  handleSearchKey
                }
                placeholder="What do you want to sell?"
                className="h-11 rounded-full border-[#e2e8f0] bg-[#f4f6fb] pl-10 text-[15px] shadow-none focus-visible:ring-[#4169e2]/30"
                autoComplete="off"
              />
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full border-[#e2e8f0]"
              title="Escanear código de barras"
              onClick={() =>
                setScannerOpen(
                  true,
                )
              }
            >
              <Camera className="h-4.5 w-4.5 text-[#4169e2]" />
            </Button>
          </div>
        </div>

        {/* Categorías */}

        <div className="flex gap-2 overflow-x-auto border-b border-[#e2e8f0] bg-white px-3 py-2.5 scrollbar-none sm:px-4">
          <button
            type="button"
            onClick={() =>
              setCategoryFilter(
                "all",
              )
            }
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-bold transition-colors",
              categoryFilter ===
                "all"
                ? "bg-[#4169e2] text-white shadow-sm"
                : "bg-[#eef1f8] text-[#4b5563]",
            )}
          >
            All
          </button>

          {categories.map(
            (category) => (
              <button
                key={
                  category.id
                }
                type="button"
                onClick={() =>
                  setCategoryFilter(
                    category.id,
                  )
                }
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-bold transition-colors",
                  categoryFilter ===
                    category.id
                    ? "bg-[#4169e2] text-white shadow-sm"
                    : "bg-[#eef1f8] text-[#4b5563]",
                )}
              >
                {category.name}
              </button>
            ),
          )}
        </div>

        {/* Productos */}

        <ScrollArea className="flex-1 bg-[#f4f6fb] p-3 sm:p-4">
          {loadingProducts ? (
            <div className="py-16 text-center text-sm text-[#9aa3b8]">
              Cargando…
            </div>
          ) : filtered.length ===
            0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-[#9aa3b8]">
              <Package className="h-10 w-10 opacity-40" />

              <p className="text-sm font-medium">
                No items found
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filtered.map(
                (product) => {
                  const outOfStock =
                    product.stock <=
                    0;

                  return (
                    <button
                      key={
                        product.id
                      }
                      type="button"
                      disabled={
                        !canSell ||
                        (
                          settings?.blockWithoutStock &&
                          outOfStock
                        )
                      }
                      onClick={() =>
                        addProduct(
                          product,
                        )
                      }
                      className="zb-product-card group relative flex flex-col items-center p-3 text-center disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {outOfStock && (
                        <span className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-[#e5484d] px-2 py-0.5 text-[10px] font-bold text-white">
                          Agotado
                        </span>
                      )}

                      <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8eefc] text-3xl">
                        {product.emoji ||
                          "📦"}
                      </div>

                      <p className="line-clamp-2 min-h-[2.25rem] text-[13px] font-semibold leading-tight text-[#1a1d26]">
                        {
                          product.name
                        }
                      </p>

                      <p className="mt-1 text-base font-bold text-[#4169e2]">
                        {money(
                          product.price,
                        )}
                      </p>

                      <p
                        className={cn(
                          "mt-0.5 text-[11px]",
                          outOfStock
                            ? "font-semibold text-[#e5484d]"
                            : "text-[#9aa3b8]",
                        )}
                      >
                        {outOfStock
                          ? "Out of stock"
                          : `Available: ${product.stock}`}
                      </p>
                    </button>
                  );
                },
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* =====================================================
          DERECHA — CARRITO
          ===================================================== */}

      <div className="flex w-full flex-col border-t border-[#e2e8f0] bg-white lg:w-[380px] lg:border-l lg:border-t-0 xl:w-[400px]">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8eefc]">
              <ShoppingCart className="h-4 w-4 text-[#4169e2]" />
            </div>

            <span className="font-bold text-[#1a1d26]">
              Order
            </span>

            {cart.length >
              0 && (
              <span className="rounded-full bg-[#4169e2] px-2 py-0.5 text-[11px] font-bold text-white">
                {cart.reduce(
                  (
                    sum,
                    line,
                  ) =>
                    sum +
                    line.quantity,
                  0,
                )}
              </span>
            )}
          </div>

          {cart.length >
            0 && (
            <button
              type="button"
              className="text-xs font-semibold text-[#e5484d]"
              onClick={() =>
                setCart([])
              }
            >
              Clear
            </button>
          )}
        </div>

        <ScrollArea className="flex-1 px-3 py-2">
          {cart.length ===
          0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-2 text-[#9aa3b8]">
              <ShoppingCart className="h-9 w-9 opacity-25" />

              <p className="text-sm">
                Tap items to add
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map(
                (line) => (
                  <div
                    key={
                      line.key
                    }
                    className="flex items-start gap-2 rounded-xl border border-[#e8ecf4] bg-[#fafbfe] p-2.5"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8eefc] text-base">
                      {line.emoji ||
                        "📦"}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#1a1d26]">
                        {
                          line.name
                        }
                      </p>

                      <p className="text-[11px] text-[#9aa3b8]">
                        {money(
                          line.unit_price,
                        )}{" "}
                        ×{" "}
                        {
                          line.quantity
                        }

                        {line.discount >
                          0 && (
                          <span className="ml-1 text-[#e5484d]">
                            −
                            {money(
                              line.discount,
                            )}
                          </span>
                        )}
                      </p>

                      <div className="mt-1.5 flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 rounded-lg border-[#e2e8f0]"
                          onClick={() =>
                            updateQty(
                              line.key,
                              -1,
                            )
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>

                        <Input
                          type="number"
                          min="0.001"
                          step="any"
                          value={
                            line.quantity
                          }
                          onChange={(
                            event,
                          ) =>
                            setQtyDirect(
                              line.key,
                              event
                                .target
                                .value,
                            )
                          }
                          className="h-7 w-14 rounded-lg border-[#e2e8f0] px-1 text-center text-sm"
                        />

                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 rounded-lg border-[#e2e8f0]"
                          onClick={() =>
                            updateQty(
                              line.key,
                              1,
                            )
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </Button>

                        <button
                          type="button"
                          className="ml-auto text-[#9aa3b8] hover:text-[#4169e2]"
                          onClick={() =>
                            openEditLine(
                              line,
                            )
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          className="text-[#9aa3b8] hover:text-[#e5484d]"
                          onClick={() =>
                            removeLine(
                              line.key,
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="shrink-0 text-sm font-bold text-[#1a1d26]">
                      {money(
                        line.unit_price *
                          line.quantity -
                          line.discount,
                      )}
                    </p>
                  </div>
                ),
              )}
            </div>
          )}
        </ScrollArea>

        {/* =================================================
            TOTALES Y PAGO
            ================================================= */}

        <div className="space-y-3 border-t border-[#e2e8f0] bg-white p-4">
          {cart.length >
            0 && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs font-medium text-[#6b7280]">
                Descuento
              </span>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  ticketDiscount
                }
                onChange={(
                  event,
                ) =>
                  setTicketDiscount(
                    event.target
                      .value,
                  )
                }
                placeholder="0.00"
                className="h-9 rounded-xl border-[#e2e8f0] text-sm"
              />
            </div>
          )}

          {cart.length >
            0 && (
            <div className="flex items-start gap-2">
              <span className="mt-2 w-20 shrink-0 text-xs font-medium text-[#6b7280]">
                <StickyNote className="mb-0.5 mr-1 inline h-3.5 w-3.5" />
                Nota
              </span>

              <Input
                value={
                  saleNotes
                }
                onChange={(
                  event,
                ) =>
                  setSaleNotes(
                    event.target
                      .value,
                  )
                }
                placeholder="Nota para el ticket (opcional)"
                className="h-9 rounded-xl border-[#e2e8f0] text-sm"
              />
            </div>
          )}

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-[#6b7280]">
              <span>
                Subtotal
              </span>

              <span>
                {money(
                  linesSubtotal,
                )}
              </span>
            </div>

            {disc > 0 && (
              <div className="flex justify-between text-[#e5484d]">
                <span>
                  Discount
                </span>

                <span>
                  −
                  {money(
                    disc,
                  )}
                </span>
              </div>
            )}

            <div className="flex justify-between text-[#6b7280]">
              <span>
                Tax
              </span>

              <span>
                {money(
                  linesTax,
                )}
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-[#e2e8f0] pt-2">
              <span className="text-base font-bold text-[#1a1d26]">
                Total
              </span>

              <span className="text-xl font-black text-[#4169e2]">
                {money(total)}
              </span>
            </div>
          </div>

          {/* Métodos de pago */}

          <div className="grid grid-cols-5 gap-1.5">
            {[
              {
                id: "cash" as const,
                label: "Cash",
                icon: Banknote,
              },

              {
                id: "card" as const,
                label: "Card",
                icon: CreditCard,
              },

              {
                id: "transfer" as const,
                label: "UPI",
                icon: Smartphone,
              },

              {
                id: "credit" as const,
                label: "Credit",
                icon: User,
              },

              {
                id: "mixed" as const,
                label: "Split",
                icon: CreditCard,
              },
            ].map(
              ({
                id,
                label,
                icon: Icon,
              }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setMethod(
                      id,
                    )
                  }
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border p-2 text-[10px] font-semibold transition-all",
                    method ===
                      id
                      ? "border-[#4169e2] bg-[#4169e2] text-white"
                      : "border-[#e8ecf4] bg-[#fafbfe] text-[#4b5563]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {
                    label
                  }
                </button>
              ),
            )}
          </div>

          {/* Efectivo */}

          {method ===
            "cash" && (
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs font-medium text-[#6b7280]">
                Received
              </span>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  cashReceived
                }
                onChange={(
                  event,
                ) =>
                  setCashReceived(
                    event.target
                      .value,
                  )
                }
                placeholder={String(
                  total.toFixed(
                    2,
                  ),
                )}
                className="h-10 rounded-xl border-[#e2e8f0]"
              />
            </div>
          )}

          {/* Pago mixto */}

          {method ===
            "mixed" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[11px] text-[#6b7280]">
                  Cash
                </span>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    mixedCash
                  }
                  onChange={(
                    event,
                  ) =>
                    setMixedCash(
                      event.target
                        .value,
                    )
                  }
                  className="h-10 rounded-xl border-[#e2e8f0]"
                />
              </div>

              <div>
                <span className="text-[11px] text-[#6b7280]">
                  Card
                </span>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    mixedCard
                  }
                  onChange={(
                    event,
                  ) =>
                    setMixedCard(
                      event.target
                        .value,
                    )
                  }
                  className="h-10 rounded-xl border-[#e2e8f0]"
                />
              </div>
            </div>
          )}

          {/* Cliente */}

          <Select
            value={
              customerId
            }
            onValueChange={
              setCustomerId
            }
          >
            <SelectTrigger className="h-10 rounded-xl border-[#e2e8f0] text-sm">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="none">
                Walk-in
              </SelectItem>

              {customers.map(
                (customer) => (
                  <SelectItem
                    key={
                      customer.id
                    }
                    value={
                      customer.id
                    }
                  >
                    {
                      customer.name
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          {method ===
            "cash" &&
            cashNum > 0 &&
            cashNum >=
              total && (
              <p className="text-center text-sm font-semibold text-[#30a46c]">
                Change:{" "}
                {money(
                  cashNum -
                    total,
                )}
              </p>
            )}

          {/* Cobrar */}

          <button
            type="button"
            disabled={
              !canSell ||
              cart.length ===
                0 ||
              checkout.isPending
            }
            onClick={() =>
              checkout.mutate()
            }
            className="zb-pay-btn flex h-12 w-full items-center justify-center gap-2 text-base disabled:opacity-50"
          >
            {checkout.isPending
              ? "Processing…"
              : `CHARGE  ${money(
                  total,
                )}`}
          </button>
        </div>
      </div>

      {/* =====================================================
          ESCÁNER
          ===================================================== */}

      <Dialog
        open={
          scannerOpen
        }
        onOpenChange={(
          open,
        ) => {
          setScannerOpen(
            open,
          );

          if (!open) {
            setScannerError(
              null,
            );
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Escanear código de barras
            </DialogTitle>
          </DialogHeader>

          {scannerError ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <CameraOff className="h-8 w-8 opacity-50" />

              <p>
                {
                  scannerError
                }
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl bg-black">
              <video
                ref={
                  videoRef
                }
                muted
                playsInline
                className="aspect-square w-full object-cover"
              />
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Apunta la cámara al código de barras del producto.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setScannerOpen(
                  false,
                )
              }
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =====================================================
          SELECTOR DE VARIANTES
          ===================================================== */}

      <Dialog
        open={
          !!variantPickerProduct
        }
        onOpenChange={(
          open,
        ) => {
          if (!open) {
            setVariantPickerProduct(
              null,
            );
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {
                variantPickerProduct?.name ??
                "Variantes"
              }
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
            {productVariants.length ===
            0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Este producto no tiene variantes configuradas.
              </p>
            ) : (
              productVariants.map(
                (variant) => {
                  const stock =
                    variantStockMap.get(
                      variant.id,
                    ) ?? 0;

                  const outOfStock =
                    stock <=
                    0;

                  const price =
                    variant.price_override !=
                    null
                      ? Number(
                          variant.price_override,
                        )
                      : variantPickerProduct?.price ??
                        0;

                  return (
                    <button
                      key={
                        variant.id
                      }
                      type="button"
                      disabled={
                        settings?.blockWithoutStock &&
                        outOfStock
                      }
                      onClick={() =>
                        variantPickerProduct &&
                        addVariant(
                          variantPickerProduct,
                          variant,
                        )
                      }
                      className="flex w-full items-center justify-between rounded-xl border border-[#e8ecf4] bg-[#fafbfe] p-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#1a1d26]">
                          {
                            variant.name
                          }
                        </p>

                        <p
                          className={cn(
                            "text-xs",
                            outOfStock
                              ? "font-semibold text-[#e5484d]"
                              : "text-[#9aa3b8]",
                          )}
                        >
                          {outOfStock
                            ? "Agotado"
                            : `Disponible: ${stock}`}
                        </p>
                      </div>

                      <span className="text-sm font-bold text-[#4169e2]">
                        {money(
                          price,
                        )}
                      </span>
                    </button>
                  );
                },
              )
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setVariantPickerProduct(
                  null,
                )
              }
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =====================================================
          EDITAR LÍNEA
          ===================================================== */}

      <Dialog
        open={
          !!editLineKey
        }
        onOpenChange={(
          open,
        ) => {
          if (!open) {
            setEditLineKey(
              null,
            );
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Editar línea
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm text-muted-foreground">
                Precio unitario{" "}
                {!isManager &&
                  "(solo lectura)"}
              </label>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  editPrice
                }
                onChange={(
                  event,
                ) =>
                  setEditPrice(
                    event.target
                      .value,
                  )
                }
                disabled={
                  !isManager
                }
                className="mt-1"
              />

              {!isManager && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Solo managers pueden modificar el precio.
                </p>
              )}
            </div>

            <div>
              <label className="text-sm text-muted-foreground">
                Descuento de línea $
              </label>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  editDiscount
                }
                onChange={(
                  event,
                ) =>
                  setEditDiscount(
                    event.target
                      .value,
                  )
                }
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setEditLineKey(
                  null,
                )
              }
            >
              Cancelar
            </Button>

            <Button
              onClick={
                applyEditLine
              }
            >
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =====================================================
          HISTORIAL
          ===================================================== */}

      <Dialog
        open={
          historyOpen
        }
        onOpenChange={
          setHistoryOpen
        }
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Ventas recientes
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2 pr-2">
              {recentSales.length ===
              0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Sin ventas recientes
                </p>
              ) : (
                recentSales.map(
                  (sale) => (
                    <div
                      key={
                        sale.id
                      }
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="font-medium">
                          Folio #
                          {
                            sale.folio
                          }{" "}
                          <Badge
                            variant="outline"
                            className="ml-1 text-xs"
                          >
                            {
                              sale.status
                            }
                          </Badge>
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {new Date(
                            sale.created_at,
                          ).toLocaleString(
                            "es-MX",
                          )}{" "}
                          ·{" "}
                          {
                            sale.payment_method
                          }{" "}
                          ·{" "}
                          {money(
                            Number(
                              sale.total,
                            ),
                          )}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          reprintSale.isPending
                        }
                        onClick={() =>
                          reprintSale.mutate(
                            sale.id,
                          )
                        }
                      >
                        <Printer className="mr-1 h-3.5 w-3.5" />
                        Ticket
                      </Button>
                    </div>
                  ),
                )
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* =====================================================
          TICKET
          ===================================================== */}

      <TicketModal
        open={
          ticketOpen
        }
        onOpenChange={
          setTicketOpen
        }
        ticket={ticket}
      />
    </div>
  );
}