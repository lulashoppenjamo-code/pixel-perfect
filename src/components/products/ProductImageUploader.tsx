
import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = 150 * 1024;
const MAX_DIMENSION = 1600;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type Props = {
  productId: string;
  disabled?: boolean;
  onUploaded: (url: string) => void;
};

type PreparedImage = {
  body: Blob;
  extension: string;
  contentType: string;
};

function canvasToWebP(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });
}

async function prepareImage(file: File): Promise<PreparedImage> {
  const originalExtension = MIME_EXTENSIONS[file.type];

  // Conservar GIF original para no perder su animación.
  if (file.type === "image/gif") {
    return {
      body: file,
      extension: "gif",
      contentType: "image/gif",
    };
  }

  // Si el navegador no admite la decodificación moderna,
  // conservar el archivo original.
  if (typeof createImageBitmap !== "function") {
    return {
      body: file,
      extension: originalExtension,
      contentType: file.type,
    };
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "No se pudo leer la imagen. Prueba con otra foto JPG, PNG o WebP.",
    );
  }

  try {
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("No se pudo preparar la imagen en este dispositivo.");
    }

    context.drawImage(bitmap, 0, 0, width, height);

    let bestBlob: Blob | null = null;

    // Probar calidades progresivas sin reducirlas en exceso.
    for (const quality of [0.86, 0.78, 0.70, 0.62, 0.55]) {
      const blob = await canvasToWebP(canvas, quality);

      if (!blob) continue;

      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }

      if (blob.size <= TARGET_BYTES) {
        bestBlob = blob;
        break;
      }
    }

    // Si WebP no está disponible, no arriesgar la imagen original.
    if (!bestBlob) {
      return {
        body: file,
        extension: originalExtension,
        contentType: file.type,
      };
    }

    // No sustituir por una versión convertida que pese más.
    if (bestBlob.size >= file.size) {
      return {
        body: file,
        extension: originalExtension,
        contentType: file.type,
      };
    }

    return {
      body: bestBlob,
      extension: "webp",
      contentType: "image/webp",
    };
  } finally {
    bitmap.close();
  }
}

export function ProductImageUploader({
  productId,
  disabled = false,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file?: File) {
    if (!file || uploading || disabled) return;

    const extension = MIME_EXTENSIONS[file.type];

    if (!extension) {
      toast.error("Formato no permitido. Usa JPG, PNG, WEBP o GIF.");
      return;
    }

    if (file.size === 0 || file.size > MAX_BYTES) {
      toast.error("La imagen debe pesar más de 0 y máximo 5 MB.");
      return;
    }

    setUploading(true);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!sessionData.session) {
        throw new Error("Inicia sesión nuevamente para subir imágenes.");
      }

      if (!productId.trim()) {
        throw new Error("Guarda primero el producto.");
      }

      const prepared = await prepareImage(file);

      const path =
        `${productId}/${crypto.randomUUID()}.${prepared.extension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, prepared.body, {
          contentType: prepared.contentType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        const message = uploadError.message.toLowerCase();

        if (
          message.includes("bucket not found") ||
          message.includes("bucket does not exist")
        ) {
          throw new Error(
            "No existe el bucket product-images en Supabase. " +
              "Hay que comprobar su configuración.",
          );
        }

        if (
          message.includes("row-level security") ||
          message.includes("violates row-level security") ||
          message.includes("unauthorized") ||
          message.includes("not allowed") ||
          message.includes("permission denied")
        ) {
          throw new Error(
            "Supabase rechazó la carga por permisos de Storage. " +
              "Hay que revisar las políticas y tus permisos de productos.",
          );
        }

        throw uploadError;
      }

      // Guardar únicamente la ruta mediante el flujo existente.
      // El formulario padre persiste products.image_url al pulsar Guardar.
      onUploaded(path);

      const sizeKB = Math.round(prepared.body.size / 1024);

      toast.success(
        `Imagen cargada (${sizeKB} KB). Pulsa Guardar para conservarla en el producto.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo subir la imagen.",
      );
    } finally {
      setUploading(false);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        disabled={disabled || uploading}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
        }}
      />

      <Button
        type="button"
        variant="outline"
        className="h-10 w-full rounded-lg"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <ImagePlus className="mr-2 h-4 w-4" />
        )}

        {uploading ? "Preparando y subiendo..." : "Elegir foto del dispositivo"}
      </Button>

      <p className="text-xs text-muted-foreground">
        JPG, PNG, WEBP o GIF. Máximo 5 MB. Las fotos compatibles se optimizan
        antes de subirlas; los GIF conservan su animación.
      </p>
    </div>
  );
}
