
import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;

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

export function ProductImageUploader({
  productId,
  disabled = false,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file?: File) {
    if (!file || uploading) return;

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

      // La política más reciente del repositorio usa el ID del
      // producto como primera carpeta del objeto.
      const path = `${productId}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type,
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
            "No existe el bucket product-images en este proyecto " +
            "de Supabase. Debe crearse en Storage antes de subir fotos."
          );
        }

        if (
          message.includes("row-level security") ||
          message.includes("violates row-level security") ||
          message.includes("unauthorized") ||
          message.includes("not allowed")
        ) {
          throw new Error(
            "Supabase rechazó la carga por permisos de Storage. " +
            "Hay que verificar las políticas existentes y el permiso " +
            "productos.create o productos.edit."
          );
        }

        throw uploadError;
      }

      const { data: publicData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(path);

      const imageUrl = publicData.publicUrl;

      if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
        throw new Error("Supabase no devolvió una URL válida.");
      }

      // Solo actualiza image_url del producto existente.
      const { error: saveError } = await supabase
        .from("products")
        .update({ image_url: imageUrl })
        .eq("id", productId);

      if (saveError) throw saveError;

      onUploaded(imageUrl);
      toast.success("Imagen subida y guardada correctamente.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo subir la imagen."
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
        {uploading ? "Subiendo imagen..." : "Elegir foto del dispositivo"}
      </Button>

      <p className="text-xs text-muted-foreground">
        JPG, PNG, WEBP o GIF. Máximo 5 MB.
      </p>
    </div>
  );
}
