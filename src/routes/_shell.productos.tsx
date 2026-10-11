
/**
 * Productos y categorías — LULA OS
 * Ruta: src/routes/_shell.productos.tsx
 *
 * - Catálogo responsive.
 * - Inventario oficial: shared_inventory.
 * - Escáner con BarcodeDetector cuando está disponible.
 * - Etiquetas PNG HD con código de barras Code 128.
 * - Sin nuevas dependencias, tablas ni migraciones.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { generateUniqueBarcode } from "@/lib/uniqueBarcode";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Trash2,
  Search,
  Package,
  RefreshCw,
  Hash,
  ScanLine,
  Download,
  X,
  Camera,
  Plus,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";
import { money } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/productos")({
  head: () => ({
    meta: [{ title: "Productos — Lula OS" }],
  }),
  component: () => (
    <RequireNavAccess navKey="productos">
      <ProductosPage />
    </RequireNavAccess>
  ),
});

type ProductForm = {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  description: string;
  category_id: string;
  price: string;
  cost: string;
  tax_rate: string;
  emoji: string;
  image_url: string;
};

const emptyProduct: ProductForm = {
  sku: "",
  barcode: "",
  name: "",
  description: "",
  category_id: "none",
  price: "0",
  cost: "0",
  tax_rate: "0.16",
  emoji: "📦",
  image_url: "",
};

type ProductRow = {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  price: number;
  cost: number;
  tax_rate: number;
  emoji: string | null;
  image_url: string | null;
  is_active: boolean;
  categories:
    | {
        name: string;
      }
    | null;
};

/*
 * Patrones oficiales de módulos Code 128.
 * El generador de etiquetas usa Code Set B.
 */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322",
  "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231",
  "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222",
  "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131",
  "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123",
  "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422",
  "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211",
  "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112",
  "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141",
  "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

function getCode128Values(value: string): number[] {
  const text = value.trim();

  if (!text) {
    throw new Error("El producto necesita un código de barras.");
  }

  // Code Set B codifica caracteres ASCII imprimibles (32–126).
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error(
        "El código contiene caracteres que no admite Code 128.",
      );
    }
  }

  const values = [104];

  for (let i = 0; i < text.length; i++) {
    values.push(text.charCodeAt(i) - 32);
  }

  let checksum = 104;

  for (let i = 1; i < values.length; i++) {
    checksum += values[i]! * i;
  }

  values.push(checksum % 103);
  values.push(106);

  return values;
}

function downloadBarcodeLabel(
  productName: string,
  price: string,
  barcode: string,
): void {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 600;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("No se pudo preparar la etiqueta.");
  }

  const values = getCode128Values(barcode);
  const patterns = values.map((value) => CODE128_PATTERNS[value]);

  if (patterns.some((pattern) => !pattern)) {
    throw new Error("No se pudo generar el código de barras.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const safeName = productName.trim() || "Producto";
  context.font = "bold 48px Arial, sans-serif";

  let displayName = safeName;

  while (
    context.measureText(displayName).width > 1080 &&
    displayName.length > 4
  ) {
    displayName = `${displayName.slice(0, -4)}…`;
  }

  context.fillText(displayName, 600, 90, 1080);

  context.font = "bold 64px Arial, sans-serif";
  context.fillText(
    money(Number(price) || 0),
    600,
    180,
    1080,
  );

  const totalModules = patterns.reduce(
    (total, pattern) =>
      total +
      [...(pattern ?? "")].reduce(
        (sum, digit) => sum + Number(digit),
        0,
      ),
    0,
  );

  const left = 70;
  const right = 1130;
  const barWidth = (right - left) / totalModules;
  const barTop = 250;
  const barHeight = 210;

  let x = left;

  context.fillStyle = "#000000";

  for (const pattern of patterns) {
    if (!pattern) continue;

    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]) * barWidth;

      if (i % 2 === 0) {
        context.fillRect(
          x,
          barTop,
          Math.max(width, 1),
          barHeight,
        );
      }

      x += width;
    }
  }

  context.font = "32px monospace";
  context.fillStyle = "#111111";
  context.fillText(barcode, 600, 510, 1080);

  canvas.toBlob((blob) => {
    if (!blob) {
      toast.error("No se pudo crear el archivo PNG.");
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `etiqueta-${barcode}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Etiqueta PNG descargada.");
  }, "image/png");
}

/*
 * Escáner de cámara.
 * No requiere librerías externas.
 */
type DetectedBarcode = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState("");
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let intervalId: number | undefined;
    let detecting = false;

    const startScanner = async () => {
      try {
        const Detector = (
          window as Window & {
            BarcodeDetector?: BarcodeDetectorConstructor;
          }
        ).BarcodeDetector;

        if (!Detector) {
          throw new Error(
            "Este navegador no admite el escáner integrado. Puedes escribir el código manualmente o probar con Chrome actualizado.",
          );
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "La cámara no está disponible. Abre Pixel Perfect mediante una conexión HTTPS y revisa los permisos del navegador.",
          );
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;

        if (!video) {
          throw new Error("No se pudo inicializar la vista de cámara.");
        }

        video.srcObject = stream;
        await video.play();

        const detector = new Detector({
          formats: [
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "code_128",
            "code_39",
            "itf",
            "codabar",
            "qr_code",
          ],
        });

        setStarting(false);

        intervalId = window.setInterval(async () => {
          if (
            cancelled ||
            detecting ||
            !videoRef.current ||
            videoRef.current.readyState < 2
          ) {
            return;
          }

          detecting = true;

          try {
            const results = await detector.detect(videoRef.current);
            const found = results.find(
              (result) => result.rawValue?.trim(),
            );

            if (found?.rawValue && !cancelled) {
              cancelled = true;
              onDetected(found.rawValue.trim());
            }
          } catch {
            // La detección puede fallar en un fotograma;
            // se vuelve a intentar en el siguiente.
          } finally {
            detecting = false;
          }
        }, 250);
      } catch (error) {
        if (!cancelled) {
          setCameraError(
            error instanceof Error
              ? error.message
              : "No se pudo iniciar el escáner.",
          );
          setStarting(false);
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;

      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-[#1a73e8]" />
            <h3 className="font-bold">Escanear código</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar escáner"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-3 p-4">
          <div className="overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="aspect-video w-full object-cover"
            />
          </div>

          {starting && (
            <p className="text-sm text-muted-foreground">
              Iniciando cámara…
            </p>
          )}

          {cameraError && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {cameraError}
            </div>
          )}

          {!cameraError && !starting && (
            <p className="text-sm text-muted-foreground">
              Centra el código de barras dentro de la cámara y espera a que se detecte.
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onClose}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}


type ProductVariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost_override: number | null;
  price_override: number | null;
  image_url: string | null;
};

type VariantForm = {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  image_url: string;
};

const emptyVariantForm: VariantForm = {
  name: "",
  sku: "",
  barcode: "",
  price: "",
  cost: "",
  image_url: "",
};

function ProductosPage() {
  const { isManager, can } = useAuth();

  const canCreate = can("productos.create");
  const canEdit = can("productos.edit");
  const canDelete = can("productos.delete");
  const canPrice = can("productos.price");

  const priceOnly = canPrice && !canEdit && !isManager;
  const canOpenForm = canEdit || canPrice || isManager;
  const canCreateProduct = !priceOnly && (canCreate || isManager);
  const canEditProduct = canEdit || isManager;

  const qc = useQueryClient();

  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState("none");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] =
    useState<"all" | "low" | "out">("all");
  const [activeTab, setActiveTab] =
    useState<"lista" | "form" | "categorias">("lista");
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [variantForm, setVariantForm] = useState<VariantForm>(emptyVariantForm);
  const [variantModalOpen, setVariantModalOpen] = useState(false);

  const {
    data: categories = [],
    isLoading: categoriesLoading,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, parent_id")
        .order("name");

      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: products = [],
    isLoading: productsLoading,
  } = useQuery<ProductRow[]>({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(`
          id,
          sku,
          barcode,
          name,
          description,
          category_id,
          price,
          cost,
          tax_rate,
          emoji,
          image_url,
          is_active,
          categories(name)
        `)
        .order("name");

      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const {
    data: sharedInventory = [],
    isLoading: inventoryLoading,
    refetch: refetchInventory,
  } = useQuery<SharedInventoryRow[]>({
    queryKey: ["shared-inventory", "products"],
    queryFn: getSharedInventory,
  });

  const {
    data: productVariants = [],
    isLoading: variantsLoading,
  } = useQuery<ProductVariantRow[]>({
    queryKey: ["product-variants", form.id ?? "none"],
    enabled: Boolean(form.id),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_variants")
        .select(
          "id, product_id, name, sku, barcode, cost_override, price_override, image_url",
        )
        .eq("product_id", form.id!)
        .order("name");

      if (error) throw error;
      return (data ?? []) as ProductVariantRow[];
    },
  });


  const stockMap = useMemo(() => {
    const map = new Map<
      string,
      {
        stock: number;
        reservedStock: number;
        availableStock: number;
        variants: number;
        hasVariants: boolean;
      }
    >();

    for (const row of sharedInventory) {
      const current = map.get(row.product_id);

      if (!current) {
        map.set(row.product_id, {
          stock: Number(row.stock ?? 0),
          reservedStock: Number(row.reserved_stock ?? 0),
          availableStock: Number(row.available_stock ?? 0),
          variants: row.variant_id ? 1 : 0,
          hasVariants: Boolean(row.variant_id),
        });
        continue;
      }

      current.stock += Number(row.stock ?? 0);
      current.reservedStock += Number(row.reserved_stock ?? 0);
      current.availableStock += Number(row.available_stock ?? 0);

      if (row.variant_id) {
        current.variants += 1;
        current.hasVariants = true;
      }
    }

    return map;
  }, [sharedInventory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return products.filter((p) => {
      if (selectedCategoryId && p.category_id !== selectedCategoryId) {
        return false;
      }

      if (q) {
        const match =
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.barcode ?? "").toLowerCase().includes(q);

        if (!match) return false;
      }

      if (stockFilter === "all") return true;

      const stock = stockMap.get(p.id);
      const available = Number(stock?.availableStock ?? 0);

      const isLow = sharedInventory.some(
        (row) =>
          row.product_id === p.id &&
          row.stock_status === "low_stock",
      );

      if (stockFilter === "out") return available <= 0;
      if (stockFilter === "low") return isLow && available > 0;

      return true;
    });
  }, [
    products,
    search,
    stockFilter,
    stockMap,
    sharedInventory,
    selectedCategoryId,
  ]);

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (!form.id) {
        if (priceOnly || !canCreateProduct) {
          throw new Error("No tienes permiso para crear productos.");
        }
      } else if (priceOnly) {
        if (!canPrice) {
          throw new Error("No tienes permiso para modificar precios.");
        }
      } else if (!canEditProduct) {
        throw new Error("No tienes permiso para editar este producto.");
      }

      if (!form.name.trim()) {
        throw new Error("Nombre requerido");
      }

      const barcodeValue = form.barcode.trim();

      if (barcodeValue && !priceOnly) {
        let q = supabase
          .from("products")
          .select("id")
          .eq("barcode", barcodeValue);

        if (form.id) q = q.neq("id", form.id);

        const { data: clash, error: barcodeError } =
          await q.maybeSingle();

        if (barcodeError) throw barcodeError;

        if (clash) {
          throw new Error(
            "Ese código de barras ya existe en otro producto. Genera uno nuevo.",
          );
        }
      }

      if (form.id && priceOnly) {
        const { error } = await (supabase as any).rpc(
          "update_product_prices",
          {
            _product_id: form.id,
            _price: Number(form.price) || 0,
            _cost: Number(form.cost) || 0,
            _tax_rate: Number(form.tax_rate) || 0,
          },
        );

        if (error) throw error;
        return;
      }

      const payload = {
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id:
          form.category_id === "none" ? null : form.category_id,
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        tax_rate: Number(form.tax_rate) || 0,
        emoji: form.emoji || "📦",
        image_url: form.image_url.trim() || null,
        is_active: true,
      };

      if (form.id) {
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", form.id);

        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("products").insert(payload);
      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(form.id ? "Producto actualizado" : "Producto creado");
      setForm(emptyProduct);

      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["inv-products"] });
      void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
      void qc.invalidateQueries({
        queryKey: ["shared-inventory", "products"],
      });
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const removeProduct = useMutation({
    mutationFn: async (id: string) => {
      if (!canDelete && !isManager) {
        throw new Error("No tienes permiso para desactivar productos.");
      }

      const { error } = await (supabase as any).rpc(
        "deactivate_product",
        { _product_id: id },
      );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Producto desactivado");
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
      void qc.invalidateQueries({
        queryKey: ["shared-inventory", "products"],
      });
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const saveCategory = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error("Solo un administrador puede crear categorías.");
      }

      if (!catName.trim()) {
        throw new Error("Nombre de categoría requerido");
      }

      const { error } = await supabase.from("categories").insert({
        name: catName.trim(),
        parent_id: catParent === "none" ? null : catParent,
      });

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Categoría creada");
      setCatName("");
      setCatParent("none");
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },

    onError: (e: Error) => toast.error(e.message),
  });


  const saveVariant = useMutation({
    mutationFn: async () => {
      if (!form.id) {
        throw new Error(
          "Primero guarda el producto y después agrega variantes.",
        );
      }

      if (!canEditProduct && !isManager) {
        throw new Error("No tienes permiso para gestionar variantes.");
      }

      const name = variantForm.name.trim();
      if (!name) {
        throw new Error("Nombre de variante requerido");
      }

      const priceVal =
        variantForm.price.trim() === ""
          ? null
          : Number(variantForm.price);
      const costVal =
        variantForm.cost.trim() === ""
          ? null
          : Number(variantForm.cost);

      if (priceVal != null && (!Number.isFinite(priceVal) || priceVal < 0)) {
        throw new Error("Precio de variante no válido");
      }
      if (costVal != null && (!Number.isFinite(costVal) || costVal < 0)) {
        throw new Error("Costo de variante no válido");
      }

      const barcodeValue = variantForm.barcode.trim();

      // Unicidad de barcode en productos y variantes (código independiente).
      if (barcodeValue && !priceOnly) {
        const { data: productClash, error: pErr } = await supabase
          .from("products")
          .select("id")
          .eq("barcode", barcodeValue)
          .maybeSingle();
        if (pErr) throw pErr;
        if (productClash) {
          throw new Error(
            "Ese código de barras ya pertenece a otro producto.",
          );
        }

        let vq = (supabase as any)
          .from("product_variants")
          .select("id")
          .eq("barcode", barcodeValue);
        if (variantForm.id) {
          vq = vq.neq("id", variantForm.id);
        }
        const { data: variantClash, error: vErr } = await vq.maybeSingle();
        if (vErr) throw vErr;
        if (variantClash) {
          throw new Error(
            "Ese código de barras ya pertenece a otra variante.",
          );
        }
      }

      if (priceOnly) {
        if (!variantForm.id) {
          throw new Error(
            "No tienes permiso para crear variantes.",
          );
        }
        const { error } = await (supabase as any)
          .from("product_variants")
          .update({
            price_override: priceVal,
            cost_override: costVal,
          })
          .eq("id", variantForm.id)
          .eq("product_id", form.id);
        if (error) throw error;
        return;
      }

      const payload = {
        product_id: form.id,
        name,
        sku: variantForm.sku.trim() || null,
        barcode: barcodeValue || null,
        price_override: priceVal,
        cost_override: costVal,
        image_url: variantForm.image_url.trim() || null,
      };

      if (variantForm.id) {
        const { error } = await (supabase as any)
          .from("product_variants")
          .update({
            name: payload.name,
            sku: payload.sku,
            barcode: payload.barcode,
            price_override: payload.price_override,
            cost_override: payload.cost_override,
            image_url: payload.image_url,
          })
          .eq("id", variantForm.id)
          .eq("product_id", form.id);

        if (error) throw error;
        return;
      }

      const { error } = await (supabase as any)
        .from("product_variants")
        .insert(payload);

      if (error) throw error;

      // Marcar el producto como con variantes (columna existente).
      const { error: flagError } = await supabase
        .from("products")
        .update({ has_variants: true })
        .eq("id", form.id);

      if (flagError) {
        // No bloqueamos la creación de la variante si el flag falla.
        console.warn("has_variants flag:", flagError.message);
      }
    },

    onSuccess: () => {
      toast.success(
        variantForm.id ? "Variante actualizada" : "Variante creada",
      );
      setVariantForm(emptyVariantForm);
      setVariantModalOpen(false);
      void qc.invalidateQueries({
        queryKey: ["product-variants", form.id ?? "none"],
      });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product-variants-purchases"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },

    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const removeVariant = useMutation({
    mutationFn: async (variantId: string) => {
      if (!form.id) {
        throw new Error("Producto no válido");
      }
      if (!canEditProduct && !isManager) {
        throw new Error("No tienes permiso para eliminar variantes.");
      }

      const { error } = await (supabase as any)
        .from("product_variants")
        .delete()
        .eq("id", variantId)
        .eq("product_id", form.id);

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Variante eliminada");
      setVariantModalOpen(false);
      setVariantForm(emptyVariantForm);
      void qc.invalidateQueries({
        queryKey: ["product-variants", form.id ?? "none"],
      });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product-variants-purchases"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({
        queryKey: ["shared-inventory", "products"],
      });
    },

    onError: (e: Error) => {
      toast.error(e.message);
    },
  });


    const editProduct = (p: ProductRow) => {
    if (!canOpenForm) {
      toast.error("No tienes permiso para abrir este producto.");
      return;
    }

    setForm({
      id: p.id,
      sku: p.sku ?? "",
      barcode: p.barcode ?? "",
      name: p.name,
      description: p.description ?? "",
      category_id: p.category_id ?? "none",
      price: String(p.price ?? 0),
      cost: String(p.cost ?? 0),
      tax_rate: String(p.tax_rate ?? 0),
      emoji: p.emoji ?? "📦",
      image_url: p.image_url ?? "",
    });

    setActiveTab("form");
  };

  const startNewProduct = () => {
    if (!canCreateProduct) {
      toast.error("No tienes permiso para crear productos.");
      return;
    }

    setForm(emptyProduct);
    setActiveTab("form");
  };

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategoryId) return null;

    return (
      categories.find((c) => c.id === selectedCategoryId)?.name ?? null
    );
  }, [categories, selectedCategoryId]);

  const inventorySummary = useMemo(() => {
    let totalUnits = 0;
    let totalAvailable = 0;
    let totalReserved = 0;
    let outOfStock = 0;
    let lowStock = 0;

    for (const item of stockMap.values()) {
      totalUnits += item.stock;
      totalAvailable += item.availableStock;
      totalReserved += item.reservedStock;

      if (item.availableStock <= 0) outOfStock += 1;
    }

    for (const row of sharedInventory) {
      if (row.stock_status === "low_stock") lowStock += 1;
    }

    return {
      totalUnits,
      totalAvailable,
      totalReserved,
      outOfStock,
      lowStock,
    };
  }, [sharedInventory, stockMap]);

  const loading = productsLoading || inventoryLoading;

  const handleBarcodeDetected = (value: string) => {
    if (variantModalOpen) {
      setVariantForm((current) => ({ ...current, barcode: value }));
    } else {
      setForm((current) => ({ ...current, barcode: value }));
    }
    setScannerOpen(false);
    toast.success(`Código leído: ${value}`);
  };

  const handleDownloadLabel = () => {
    try {
      downloadBarcodeLabel(form.name, form.price, form.barcode);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar la etiqueta.",
      );
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={Package}
        title="La gestión del inventario"
        description="Artículos, categorías, precios y existencias."
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-4">
        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Productos
            </p>
            <p className="text-xl font-bold text-[#1a73e8] sm:text-2xl">
              {products.length}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Disponibles
            </p>
            <p className="text-xl font-bold text-[#212121] sm:text-2xl">
              {inventorySummary.totalAvailable}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Reservado
            </p>
            <p className="text-xl font-bold text-[#212121] sm:text-2xl">
              {inventorySummary.totalReserved}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Agotados
            </p>
            <p className="text-xl font-bold text-[#c2185b] sm:text-2xl">
              {inventorySummary.outOfStock}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "lista" | "form" | "categorias")
        }
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="flex h-auto w-max min-w-full flex-nowrap gap-1 rounded-xl border border-[#e0e0e0] bg-white p-1 shadow-sm sm:w-full">
            <TabsTrigger
              value="lista"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Artículos
            </TabsTrigger>
            <TabsTrigger
              value="form"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              {form.id ? "Editar" : "Nuevo"}
            </TabsTrigger>
            <TabsTrigger
              value="categorias"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Categoría
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="lista" className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 rounded-xl border border-[#e0e0e0] bg-white pl-9 shadow-sm placeholder:text-[#9e9e9e]"
                placeholder="Buscar artículo, SKU o código…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 touch-manipulation rounded-xl"
              onClick={() => void refetchInventory()}
              title="Actualizar existencias"
              aria-label="Actualizar existencias"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            {(
              [
                ["all", "Todos"],
                ["low", "Inventario bajo"],
                ["out", "Agotado"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStockFilter(key)}
                className={
                  stockFilter === key
                    ? "shrink-0 rounded-full bg-[#7c4dff] px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm"
                    : "shrink-0 rounded-full bg-[#eeeeee] px-3.5 py-1.5 text-[12px] font-medium text-[#616161]"
                }
              >
                {label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
              Cargando...
            </div>
          )}

          {selectedCategoryName && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e3f2fd] bg-[#e3f2fd]/60 px-3 py-2">
              <span className="text-sm text-[#1565c0]">
                Categoría: <strong>{selectedCategoryName}</strong>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-[#90caf9] text-[#1565c0]"
                onClick={() => setSelectedCategoryId(null)}
              >
                Ver todos
              </Button>
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e0e0e0] bg-white px-5 py-12 text-center shadow-sm sm:px-6 sm:py-14">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#e8f0fe] text-4xl">
                📦
              </div>
              <div>
                <p className="text-base font-bold text-[#212121]">
                  Sin artículos
                </p>
                <p className="mt-1 max-w-sm text-sm leading-5 text-[#757575]">
                  Crea un producto en la pestaña Nuevo o ajusta la búsqueda.
                </p>
                {canCreateProduct && (
                  <Button className="mt-3 rounded-xl" onClick={startNewProduct}>
                    + Crear nuevo
                  </Button>
                )}
              </div>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="space-y-2 pb-20">
              {filtered.map((p) => {
                const stock = stockMap.get(p.id);
                const available = Number(stock?.availableStock ?? 0);
                const reserved = Number(stock?.reservedStock ?? 0);
                const hasVariants = stock?.hasVariants ?? false;
                const agotado = available <= 0;

                const lowStock =
                  !agotado &&
                  Boolean(stock) &&
                  sharedInventory.some(
                    (row) =>
                      row.product_id === p.id &&
                      row.stock_status === "low_stock",
                  );

                const marginPct =
                  Number(p.cost) > 0 && Number(p.price) > 0
                    ? (
                        ((Number(p.price) - Number(p.cost)) /
                          Number(p.price)) *
                        100
                      ).toFixed(3)
                    : null;

                const variantRows = sharedInventory.filter(
                  (row) => row.product_id === p.id && row.variant_id,
                );

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "rounded-xl border border-[#e8e8e8] bg-white px-3 py-3 shadow-sm transition",
                      canOpenForm &&
                        "cursor-pointer touch-manipulation active:scale-[0.995] hover:border-[#90caf9] hover:shadow",
                      !p.is_active && "opacity-50",
                    )}
                    onClick={() => {
                      if (canOpenForm) editProduct(p);
                    }}
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Enter" || e.key === " ") &&
                        canOpenForm
                      ) {
                        e.preventDefault();
                        editProduct(p);
                      }
                    }}
                  >
                    <div className="flex gap-3">
                      {/* Imagen */}
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f5f5f5] sm:h-[72px] sm:w-[72px]">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-2xl">
                            {p.emoji ?? "📦"}
                          </span>
                        )}
                      </div>

                      {/* Contenido principal */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold leading-snug text-[#212121]">
                              {p.name}
                              {p.sku ? (
                                <span className="ml-1 font-normal text-[#757575]">
                                  {p.sku}
                                </span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-[15px] font-bold text-[#1a73e8]">
                              {money(Number(p.price))}
                              {marginPct !== null && (
                                <span className="ml-1 text-[12px] font-semibold text-[#34a853]">
                                  ({marginPct}%)
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="shrink-0 pt-0.5 text-right">
                            {agotado ? (
                              <span className="text-[13px] font-medium text-[#e53935]">
                                Agotado
                              </span>
                            ) : lowStock ? (
                              <span className="text-[13px] font-medium text-[#ef6c00]">
                                {available} En existencia
                              </span>
                            ) : (
                              <span className="text-[13px] font-medium text-[#757575]">
                                {available} En existencia
                              </span>
                            )}
                            {reserved > 0 && (
                              <p className="text-[11px] text-[#9e9e9e]">
                                {reserved} res.
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Chips de variantes / códigos estilo Zobaze */}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {variantRows.length > 0
                            ? variantRows.slice(0, 6).map((row) => (
                                <span
                                  key={row.id}
                                  className="inline-flex max-w-[140px] truncate rounded-md bg-[#1a73e8] px-2.5 py-1 text-[11px] font-semibold text-white"
                                  title={
                                    row.sku ||
                                    row.barcode ||
                                    row.product_name
                                  }
                                >
                                  {row.sku ||
                                    row.barcode ||
                                    "Var"}
                                </span>
                              ))
                            : (p.sku || p.barcode) && (
                                <span className="inline-flex max-w-[140px] truncate rounded-md bg-[#1a73e8] px-2.5 py-1 text-[11px] font-semibold text-white">
                                  {p.sku || p.barcode}
                                </span>
                              )}
                          {hasVariants &&
                            variantRows.length > 6 && (
                              <span className="inline-flex items-center rounded-md bg-[#e8e8e8] px-2 py-1 text-[11px] font-medium text-[#616161]">
                                +{variantRows.length - 6}
                              </span>
                            )}
                        </div>
                      </div>

                      {canDelete && p.is_active && (
                        <button
                          type="button"
                          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProduct.mutate(p.id);
                          }}
                          aria-label={`Desactivar ${p.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* FAB estilo Zobaze */}
          <div className="pointer-events-none fixed bottom-20 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6">
            {canCreateProduct && (
              <button
                type="button"
                className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#1a73e8] text-2xl font-light text-white shadow-lg transition hover:bg-[#1557b0] active:scale-95"
                onClick={startNewProduct}
                aria-label="Crear producto"
              >
                +
              </button>
            )}
          </div>
        </TabsContent>

        <TabsContent value="form" className="mt-3 sm:mt-4">
          <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-[#e0e0e0] bg-white shadow-sm">
            {/* Barra superior estilo Zobaze */}
            <div className="flex items-center gap-2 border-b border-[#e8e8e8] bg-white px-3 py-2.5">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#616161] hover:bg-[#f5f5f5]"
                onClick={() => {
                  setForm(emptyProduct);
                  setActiveTab("lista");
                }}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>

              {form.id && (canDelete || isManager) && (
                <Button
                  type="button"
                  className="h-9 rounded-md bg-[#e53935] px-4 text-sm font-bold text-white hover:bg-[#c62828]"
                  disabled={removeProduct.isPending}
                  onClick={() => {
                    if (form.id) removeProduct.mutate(form.id);
                  }}
                >
                  BORRAR
                </Button>
              )}

              <h2 className="flex-1 text-center text-[15px] font-bold uppercase tracking-wide text-[#1a73e8]">
                {form.id ? "Gestionar artículo" : "Nuevo artículo"}
              </h2>

              {form.id && canCreateProduct && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg border-[#1a73e8] text-[#1a73e8]"
                  onClick={startNewProduct}
                >
                  + Nuevo
                </Button>
              )}
            </div>

            <div className="space-y-4 p-3.5 sm:p-5">
              <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[76px_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <Label className="text-xs text-[#757575]">Emoji</Label>
                  <Input
                    value={form.emoji}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, emoji: e.target.value }))
                    }
                    className="h-11 rounded-xl border-[#e0e0e0] text-center text-lg"
                    disabled={priceOnly}
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs text-[#757575]">Nombre *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="Nombre del producto"
                    className="h-11 rounded-xl border-[#e0e0e0]"
                    disabled={priceOnly}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-[#757575]">
                  Imagen del producto
                </Label>

                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#e0e0e0] bg-[#f5f5f5] text-2xl">
                    {form.image_url ? (
                      <img
                        src={form.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{form.emoji || "📦"}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="h-11 cursor-pointer rounded-xl border-[#e0e0e0] text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-[#e8f0fe] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1a73e8]"
                      disabled={
                        priceOnly ||
                        !(canCreateProduct || canEditProduct) ||
                        saveProduct.isPending
                      }
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;

                        if (
                          priceOnly ||
                          !(canCreateProduct || canEditProduct)
                        ) {
                          toast.error(
                            "No tienes permiso para cambiar imágenes.",
                          );
                          event.target.value = "";
                          return;
                        }

                        if (file.size > 5 * 1024 * 1024) {
                          toast.error("La imagen no debe superar 5 MB");
                          event.target.value = "";
                          return;
                        }

                        try {
                          const ext =
                            file.name.split(".").pop()?.toLowerCase() ||
                            "jpg";

                          const {
                            data: { user: upUser },
                          } = await supabase.auth.getUser();

                          if (!upUser?.id) {
                            throw new Error(
                              "Sesión requerida para subir imagen",
                            );
                          }

                          if (!form.id) {
                            throw new Error(
                              "Primero guarda el producto y después agrega la imagen.",
                            );
                          }

                          const path = `${form.id}/${crypto.randomUUID()}.${ext}`;

                          const { error: upErr } = await supabase.storage
                            .from("product-images")
                            .upload(path, file, {
                              upsert: false,
                              contentType: file.type || "image/jpeg",
                            });

                          if (upErr) throw upErr;

                          const { data: pub } = supabase.storage
                            .from("product-images")
                            .getPublicUrl(path);

                          setForm((f) => ({
                            ...f,
                            image_url: pub.publicUrl,
                          }));

                          toast.success("Imagen cargada");
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "No se pudo subir la imagen",
                          );
                        } finally {
                          event.target.value = "";
                        }
                      }}
                    />

                    {form.image_url && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-lg"
                        disabled={
                          priceOnly ||
                          !(canCreateProduct || canEditProduct)
                        }
                        onClick={() =>
                          setForm((f) => ({ ...f, image_url: "" }))
                        }
                      >
                        Quitar imagen
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-3 sm:p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Códigos
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">SKU</Label>
                    <Input
                      value={form.sku}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, sku: e.target.value }))
                      }
                      placeholder="SKU-001"
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white font-mono text-sm"
                      disabled={priceOnly}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      Código de barras
                    </Label>

                    <Input
                      value={form.barcode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          barcode: e.target.value.slice(0, 64),
                        }))
                      }
                      placeholder="EAN / UPC o código interno"
                      maxLength={64}
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white font-mono text-sm"
                      disabled={priceOnly}
                    />

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl border-[#e0e0e0]"
                        disabled={
                          priceOnly ||
                          !(canCreateProduct || canEditProduct) ||
                          saveProduct.isPending
                        }
                        onClick={async () => {
                          try {
                            const code = await generateUniqueBarcode(10);
                            setForm((f) => ({ ...f, barcode: code }));
                            toast.success(`Código generado: ${code}`);
                          } catch (error) {
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "No se pudo generar el código",
                            );
                          }
                        }}
                      >
                        <Hash className="mr-2 h-4 w-4" />
                        Generar
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl border-[#e0e0e0]"
                        disabled={
                          priceOnly ||
                          !(canCreateProduct || canEditProduct) ||
                          saveProduct.isPending
                        }
                        onClick={() => setScannerOpen(true)}
                      >
                        <ScanLine className="mr-2 h-4 w-4" />
                        Escanear
                      </Button>
                    </div>

                    <Button
                      type="button"
                      className="h-11 w-full rounded-xl bg-[#1a73e8] hover:bg-[#1557b0]"
                      disabled={!form.barcode.trim()}
                      onClick={handleDownloadLabel}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Descargar etiqueta PNG HD
                    </Button>

                    <p className="text-[10px] text-[#757575]">
                      La etiqueta usa Code 128. El escáner depende del soporte
                      del navegador y de los permisos de cámara.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-[#757575]">
                  Descripción
                </Label>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border-[#e0e0e0]"
                  disabled={priceOnly}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-[#757575]">Categoría</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, category_id: v }))
                  }
                  disabled={priceOnly}
                >
                  <SelectTrigger className="h-11 rounded-xl border-[#e0e0e0]">
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin categoría</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-3 sm:p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Precios
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      Precio venta
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, price: e.target.value }))
                      }
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white text-base font-bold text-[#1a73e8]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">Costo</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cost}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, cost: e.target.value }))
                      }
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">IVA</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.tax_rate}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, tax_rate: e.target.value }))
                      }
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white"
                    />
                  </div>
                </div>

                {Number(form.price) > 0 && Number(form.cost) >= 0 && (
                  <p className="mt-2 break-words text-xs text-[#757575]">
                    Margen aprox.:{" "}
                    <span className="font-semibold text-[#34a853]">
                      {money(Number(form.price) - Number(form.cost))}
                    </span>{" "}
                    (
                    {(
                      ((Number(form.price) - Number(form.cost)) /
                        Number(form.price)) *
                      100
                    ).toFixed(0)}
                    %)
                  </p>
                )}
              </div>

              {/* EXISTENCIAS — solo lectura desde shared_inventory */}
              {form.id && (
                <div className="rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-3 sm:p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                    Existencias
                  </p>
                  {(() => {
                    const stock = stockMap.get(form.id!);
                    const available = Number(stock?.availableStock ?? 0);
                    const reserved = Number(stock?.reservedStock ?? 0);
                    const physical = Number(stock?.stock ?? 0);
                    const isLow = sharedInventory.some(
                      (row) =>
                        row.product_id === form.id &&
                        row.stock_status === "low_stock",
                    );
                    const agotado = available <= 0;
                    const statusLabel = agotado
                      ? "Agotado"
                      : isLow
                        ? "Inventario bajo"
                        : "OK";
                    const statusClass = agotado
                      ? "text-[#e53935]"
                      : isLow
                        ? "text-[#ef6c00]"
                        : "text-[#34a853]";

                    return (
                      <>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="rounded-xl border border-[#eeeeee] bg-white px-3 py-2">
                            <p className="text-[10px] uppercase text-[#9e9e9e]">
                              Disponibles
                            </p>
                            <p
                              className={`text-lg font-bold ${
                                agotado ? "text-[#e53935]" : "text-[#212121]"
                              }`}
                            >
                              {available}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#eeeeee] bg-white px-3 py-2">
                            <p className="text-[10px] uppercase text-[#9e9e9e]">
                              Reservado
                            </p>
                            <p className="text-lg font-bold text-[#212121]">
                              {reserved}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#eeeeee] bg-white px-3 py-2">
                            <p className="text-[10px] uppercase text-[#9e9e9e]">
                              Físico
                            </p>
                            <p className="text-lg font-bold text-[#212121]">
                              {physical}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#eeeeee] bg-white px-3 py-2">
                            <p className="text-[10px] uppercase text-[#9e9e9e]">
                              Estado
                            </p>
                            <p className={`text-lg font-bold ${statusClass}`}>
                              {statusLabel}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-[#9e9e9e]">
                          Solo lectura. El stock se ajusta en Inventario o al
                          recibir compras. Al vender, el POS descuenta del
                          inventario compartido.
                        </p>
                      </>
                    );
                  })()}
                </div>
              )}

              {!form.id && (
                <p className="rounded-xl border border-dashed border-[#e0e0e0] bg-white px-3 py-2 text-xs text-[#757575]">
                  Guarda el artículo para ver existencias del inventario
                  compartido.
                </p>
              )}

              {/* VARIANTES estilo Zobaze — sin límite */}
              {form.id && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                      Variantes
                    </p>
                    {(canEditProduct || isManager) && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-lg bg-[#1a73e8] text-white hover:bg-[#1557b0]"
                        onClick={() => {
                          setVariantForm({
                            ...emptyVariantForm,
                            price: form.price,
                            cost: form.cost,
                            image_url: form.image_url || "",
                          });
                          setVariantModalOpen(true);
                        }}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Agregar variante
                      </Button>
                    )}
                  </div>

                  {!form.id ? null : variantsLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Cargando variantes…
                    </p>
                  ) : productVariants.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#e0e0e0] px-3 py-6 text-center text-sm text-[#757575]">
                      Sin variantes. Agrega todas las que necesites (sin
                      límite).
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {productVariants.map((v) => {
                        const inv = sharedInventory.find(
                          (row) =>
                            row.product_id === form.id &&
                            row.variant_id === v.id,
                        );
                        const available = Number(
                          inv?.available_stock ?? 0,
                        );
                        const price =
                          v.price_override != null
                            ? Number(v.price_override)
                            : Number(form.price) || 0;
                        const cost =
                          v.cost_override != null
                            ? Number(v.cost_override)
                            : Number(form.cost) || 0;

                        return (
                          <button
                            key={v.id}
                            type="button"
                            className="w-full rounded-xl border border-[#e8e8e8] bg-white p-3 text-left shadow-sm transition hover:border-[#90caf9]"
                            onClick={() => {
                              if (!(canEditProduct || isManager || canPrice)) {
                                return;
                              }
                              setVariantForm({
                                id: v.id,
                                name: v.name,
                                sku: v.sku ?? "",
                                barcode: v.barcode ?? "",
                                price:
                                  v.price_override != null
                                    ? String(v.price_override)
                                    : form.price,
                                cost:
                                  v.cost_override != null
                                    ? String(v.cost_override)
                                    : form.cost,
                                image_url: v.image_url ?? form.image_url ?? "",
                              });
                              setVariantModalOpen(true);
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f5f5f5] text-xl">
                                {form.image_url ? (
                                  <img
                                    src={form.image_url}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span>{form.emoji || "📦"}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-[#212121]">
                                  {v.name}
                                  {v.sku ? (
                                    <span className="ml-1 font-normal text-[#757575]">
                                      {v.sku}
                                    </span>
                                  ) : null}
                                </p>
                                {v.barcode ? (
                                  <p className="truncate font-mono text-[11px] text-[#9e9e9e]">
                                    {v.barcode}
                                  </p>
                                ) : null}
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[11px] text-[#757575]">
                                  <span>
                                    Venta{" "}
                                    <strong className="text-[#1a73e8]">
                                      {money(price)}
                                    </strong>
                                  </span>
                                  <span>
                                    Costo{" "}
                                    <strong>{money(cost)}</strong>
                                  </span>
                                  <span className="text-right">
                                    {available <= 0 ? (
                                      <strong className="text-[#e53935]">
                                        Agotado
                                      </strong>
                                    ) : (
                                      <strong>{available} disp.</strong>
                                    )}
                                  </span>
                                </div>
                                {v.barcode ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <span className="font-mono text-[10px] text-[#9e9e9e]">
                                      {v.barcode}
                                    </span>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded-md border border-[#34a853]/40 bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-semibold text-[#2e7d32]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        try {
                                          const labelName = [
                                            form.name?.trim(),
                                            v.name,
                                          ]
                                            .filter(Boolean)
                                            .join(" — ");
                                          downloadBarcodeLabel(
                                            labelName || v.name,
                                            String(price),
                                            v.barcode!,
                                          );
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error
                                              ? err.message
                                              : "No se pudo crear la etiqueta",
                                          );
                                        }
                                      }}
                                    >
                                      <Download className="h-3 w-3" />
                                      Etiqueta
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!form.id && (canCreateProduct) && (
                <p className="rounded-xl bg-[#e8f0fe] px-3 py-2 text-xs text-[#1565c0]">
                  Guarda el producto primero para poder agregar variantes
                  ilimitadas.
                </p>
              )}

              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button
                  className="min-h-11 w-full touch-manipulation rounded-xl bg-[#1a73e8] text-base font-semibold hover:bg-[#1557b0] sm:flex-1"
                  disabled={
                    saveProduct.isPending ||
                    (form.id
                      ? !(priceOnly ? canPrice : canEditProduct)
                      : !canCreateProduct)
                  }
                  onClick={() => saveProduct.mutate()}
                >
                  {saveProduct.isPending
                    ? "Guardando…"
                    : form.id
                      ? "Guardar cambios"
                      : "Crear artículo"}
                </Button>

                {form.id && (
                  <Button
                    variant="outline"
                    className="min-h-11 w-full touch-manipulation rounded-xl border-[#e0e0e0] sm:w-auto"
                    onClick={() => {
                      setForm(emptyProduct);
                      setActiveTab("lista");
                    }}
                  >
                    Cancelar
                  </Button>
                )}

                {canCreateProduct && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full touch-manipulation rounded-xl border-[#1a73e8] text-[#1a73e8] sm:w-auto"
                    onClick={startNewProduct}
                  >
                    + Crear nuevo
                  </Button>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="categorias" className="mt-3 sm:mt-4">
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Nueva categoría
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nombre</Label>
                  <Input
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    className="h-11 rounded-xl"
                    disabled={!isManager}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Padre (opcional)</Label>
                  <Select
                    value={catParent}
                    onValueChange={setCatParent}
                    disabled={!isManager}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ninguno</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="min-h-11 w-full touch-manipulation rounded-xl"
                  disabled={!isManager || saveCategory.isPending}
                  onClick={() => saveCategory.mutate()}
                >
                  {saveCategory.isPending ? "Creando…" : "Crear categoría"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Listado</CardTitle>
              </CardHeader>

              <CardContent>
                {categoriesLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Cargando categorías…
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {categories.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center rounded-xl border px-3 py-2.5 text-left transition hover:border-[#1a73e8] hover:bg-[#e8f0fe] active:scale-[0.99]"
                          onClick={() => {
                            setSelectedCategoryId(c.id);
                            setActiveTab("lista");
                          }}
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}

                    {!categories.length && (
                      <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                        Sin categorías.
                      </li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>


      {variantModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-white px-3 py-2.5">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#f5f5f5]"
                onClick={() => {
                  setVariantModalOpen(false);
                  setVariantForm(emptyVariantForm);
                }}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
              {variantForm.id && (canEditProduct || isManager) && (
                <Button
                  type="button"
                  className="h-9 rounded-md bg-[#e53935] px-4 text-sm font-bold text-white hover:bg-[#c62828]"
                  disabled={removeVariant.isPending}
                  onClick={() => {
                    if (variantForm.id) {
                      removeVariant.mutate(variantForm.id);
                    }
                  }}
                >
                  BORRAR
                </Button>
              )}
              <h3 className="flex-1 text-center text-[15px] font-bold uppercase tracking-wide text-[#1a73e8]">
                {variantForm.id ? "Editar variante" : "Nueva variante"}
              </h3>
              <span className="w-9" />
            </div>

            <div className="space-y-4 p-4">
              <div className="flex gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[#f5f5f5] text-2xl">
                  {variantForm.image_url ? (
                    <img
                      src={variantForm.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : form.image_url ? (
                    <img
                      src={form.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>{form.emoji || "📦"}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-xs text-[#757575]">
                    Nombre de variante *
                  </Label>
                  <Input
                    value={variantForm.name}
                    onChange={(e) =>
                      setVariantForm((f) => ({
                        ...f,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Ej. FB1027 / Rojo / Talla M"
                    className="h-11 rounded-xl"
                    disabled={priceOnly}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-[#757575]">
                  Imagen de la variante
                </Label>
                <Input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="h-11 cursor-pointer rounded-xl border-[#e0e0e0] text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-[#e8f0fe] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1a73e8]"
                  disabled={
                    priceOnly ||
                    !(canEditProduct || isManager) ||
                    saveVariant.isPending
                  }
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (priceOnly || !(canEditProduct || isManager)) {
                      toast.error("No tienes permiso para cambiar imágenes.");
                      event.target.value = "";
                      return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("La imagen no debe superar 5 MB");
                      event.target.value = "";
                      return;
                    }
                    try {
                      const ext =
                        file.name.split(".").pop()?.toLowerCase() || "jpg";
                      const {
                        data: { user: upUser },
                      } = await supabase.auth.getUser();
                      if (!upUser?.id) {
                        throw new Error("Sesión requerida para subir imagen");
                      }
                      if (!form.id) {
                        throw new Error(
                          "Guarda el producto antes de subir imagen de variante.",
                        );
                      }
                      const path = `${form.id}/variants/${crypto.randomUUID()}.${ext}`;
                      const { error: upErr } = await supabase.storage
                        .from("product-images")
                        .upload(path, file, {
                          upsert: false,
                          contentType: file.type || "image/jpeg",
                        });
                      if (upErr) throw upErr;
                      const { data: pub } = supabase.storage
                        .from("product-images")
                        .getPublicUrl(path);
                      setVariantForm((f) => ({
                        ...f,
                        image_url: pub.publicUrl,
                      }));
                      toast.success("Imagen de variante cargada");
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "No se pudo subir la imagen",
                      );
                    } finally {
                      event.target.value = "";
                    }
                  }}
                />
                {variantForm.image_url && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg"
                    disabled={priceOnly || !(canEditProduct || isManager)}
                    onClick={() =>
                      setVariantForm((f) => ({ ...f, image_url: "" }))
                    }
                  >
                    Quitar imagen
                  </Button>
                )}
              </div>

              <div className="rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-3 sm:p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Códigos (independientes del producto)
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">SKU</Label>
                    <Input
                      value={variantForm.sku}
                      onChange={(e) =>
                        setVariantForm((f) => ({
                          ...f,
                          sku: e.target.value,
                        }))
                      }
                      placeholder="SKU variante"
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white font-mono text-sm"
                      disabled={priceOnly}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      Código de barras
                    </Label>
                    <Input
                      value={variantForm.barcode}
                      onChange={(e) =>
                        setVariantForm((f) => ({
                          ...f,
                          barcode: e.target.value.slice(0, 64),
                        }))
                      }
                      placeholder="EAN / UPC o genérico"
                      maxLength={64}
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white font-mono text-sm"
                      disabled={priceOnly}
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-[#e0e0e0]"
                    disabled={
                      priceOnly ||
                      !(canEditProduct || isManager) ||
                      saveVariant.isPending
                    }
                    onClick={async () => {
                      try {
                        const code = await generateUniqueBarcode(10);
                        setVariantForm((f) => ({ ...f, barcode: code }));
                        toast.success(`Código generado: ${code}`);
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "No se pudo generar el código",
                        );
                      }
                    }}
                  >
                    <Hash className="mr-1 h-4 w-4" />
                    Generar
                  </Button>
                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-[#1a73e8] text-white hover:bg-[#1557b0]"
                    disabled={
                      priceOnly ||
                      !(canEditProduct || isManager) ||
                      saveVariant.isPending
                    }
                    onClick={() => setScannerOpen(true)}
                  >
                    <ScanLine className="mr-1 h-4 w-4" />
                    Escanear
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full rounded-xl border-[#34a853] text-[#2e7d32] sm:w-auto"
                    disabled={!variantForm.barcode.trim()}
                    onClick={() => {
                      const code = variantForm.barcode.trim();
                      if (!code) {
                        toast.error(
                          "Primero genera o escribe el código de barras de la variante.",
                        );
                        return;
                      }
                      try {
                        // Nombre de variante + producto para identificarla al imprimir
                        const labelName = [
                          form.name?.trim(),
                          variantForm.name.trim(),
                        ]
                          .filter(Boolean)
                          .join(" — ");
                        downloadBarcodeLabel(
                          labelName || "Variante",
                          variantForm.price || form.price,
                          code,
                        );
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "No se pudo crear la etiqueta",
                        );
                      }
                    }}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Descargar etiqueta PNG HD
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-[#757575]">
                    Precio venta
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={variantForm.price}
                    onChange={(e) =>
                      setVariantForm((f) => ({
                        ...f,
                        price: e.target.value,
                      }))
                    }
                    className="h-11 rounded-xl font-bold text-[#1a73e8]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[#757575]">Costo</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={variantForm.cost}
                    onChange={(e) =>
                      setVariantForm((f) => ({
                        ...f,
                        cost: e.target.value,
                      }))
                    }
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[#757575]">
                    Margen (%)
                  </Label>
                  <div className="flex h-11 items-center justify-center rounded-xl border bg-[#fafafa] text-sm font-semibold text-[#34a853]">
                    {Number(variantForm.price) > 0
                      ? (
                          ((Number(variantForm.price) -
                            Number(variantForm.cost || 0)) /
                            Number(variantForm.price)) *
                          100
                        ).toFixed(3)
                      : "—"}
                  </div>
                </div>
              </div>

              {variantForm.id && (
                <div className="rounded-xl border bg-[#fafafa] px-3 py-2">
                  <p className="text-[10px] uppercase text-[#9e9e9e]">
                    Existencias disponibles
                  </p>
                  <p className="text-lg font-bold text-[#212121]">
                    {Number(
                      sharedInventory.find(
                        (row) =>
                          row.product_id === form.id &&
                          row.variant_id === variantForm.id,
                      )?.available_stock ?? 0,
                    )}
                  </p>
                  <p className="text-[10px] text-[#9e9e9e]">
                    Solo lectura — se ajusta en inventario / compras
                  </p>
                </div>
              )}

              <Button
                className="min-h-11 w-full rounded-xl bg-[#1a73e8] text-base font-semibold hover:bg-[#1557b0]"
                disabled={
                  saveVariant.isPending ||
                  (!(canEditProduct || isManager) && !canPrice)
                }
                onClick={() => saveVariant.mutate()}
              >
                {saveVariant.isPending
                  ? "Guardando…"
                  : variantForm.id
                    ? "Guardar variante"
                    : "Crear variante"}
              </Button>
            </div>
          </div>
        </div>
      )}


      {scannerOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </PageShell>
  );
}
