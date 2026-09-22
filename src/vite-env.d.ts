/// <reference types="vite/client" />

// Entornos expuestos por Vite. Declarados explícitamente para que el cliente
// generado (@/integrations/supabase/client) pueda leerlos con punto sin
// tropezar con noPropertyAccessFromIndexSignature.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_PROJECT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
