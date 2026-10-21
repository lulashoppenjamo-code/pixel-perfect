import { useEffect, useState } from "react";
import { validImageUrl } from "@/lib/productImport";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";
const SIGNED_URL_TTL_SECONDS = 3600;
const signedUrlCache = new Map<string, string>();

function isStoragePath(value: string): boolean {
  return (
    !validImageUrl(value) &&
    !value.startsWith("data:") &&
    !value.startsWith("blob:") &&
    /^[^\s/][^\s]*\/[^\s]+$/.test(value)
  );
}

export function ProductImage({ src, emoji, name, className = "h-full w-full object-contain" }: { src?: string | null; emoji?: string | null; name?: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const value = src?.trim() ?? "";
  const remoteUrl = value && validImageUrl(value) ? value : null;
  const storagePath = !remoteUrl && value && isStoragePath(value) ? value : null;

  useEffect(() => {
    if (!storagePath) {
      setSignedUrl(null);
      return;
    }
    const cached = signedUrlCache.get(storagePath);
    if (cached) {
      setSignedUrl(cached);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.signedUrl) {
          signedUrlCache.set(storagePath, data.signedUrl);
          setSignedUrl(data.signedUrl);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  const resolved = remoteUrl ?? signedUrl;
  if (!resolved || failedUrl === resolved) return <span aria-label={name ? `Imagen de ${name} no disponible` : "Imagen no disponible"}>{emoji || "📦"}</span>;
  return <img src={resolved} alt={name ?? ""} className={className} loading="lazy" onError={() => setFailedUrl(resolved)} />;
}
