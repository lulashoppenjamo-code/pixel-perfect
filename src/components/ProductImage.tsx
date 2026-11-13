
import { useEffect, useState } from "react";
import { validImageUrl } from "@/lib/productImport";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";

function getImageUrl(value: string): string | null {
  if (!value) return null;

  // Si ya es una URL de Supabase Storage, convertirla a pública
  // para evitar que los enlaces firmados caduquen.
  if (validImageUrl(value)) {
    try {
      const url = new URL(value);
      const signedPrefix = `/storage/v1/object/sign/${BUCKET}/`;
      const publicPrefix = `/storage/v1/object/public/${BUCKET}/`;

      const prefix = url.pathname.startsWith(signedPrefix)
        ? signedPrefix
        : url.pathname.startsWith(publicPrefix)
          ? publicPrefix
          : null;

      if (prefix) {
        const path = decodeURIComponent(
          url.pathname.slice(prefix.length),
        );

        return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
    } catch {
      return value;
    }

    // Las imágenes externas siguen funcionando como antes.
    return value;
  }

  // Las rutas guardadas por el inventario, por ejemplo:
  // identificador-del-producto/foto.webp
  if (
    !value.startsWith("data:") &&
    !value.startsWith("blob:") &&
    /^[^\s/][^\s]*\/[^\s]+$/.test(value)
  ) {
    return supabase.storage.from(BUCKET).getPublicUrl(value).data.publicUrl;
  }

  return null;
}

export function ProductImage({
  src,
  emoji,
  name,
  className = "h-full w-full object-contain",
}: {
  src?: string | null;
  emoji?: string | null;
  name?: string;
  className?: string;
}) {
  const value = src?.trim() ?? "";
  const resolved = getImageUrl(value);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [resolved]);

  if (!resolved || failedUrl === resolved) {
    return (
      <span
        className="flex items-center justify-center"
        aria-label={
          name ? `Imagen de ${name} no disponible` : "Imagen no disponible"
        }
      >
        {emoji || "📦"}
      </span>
    );
  }

  return (
    <img
      src={resolved}
      alt={name ?? ""}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailedUrl(resolved)}
    />
  );
}
