import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { BranchProvider } from "@/lib/branch";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>

        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Página no encontrada
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          La página que buscas no existe o fue movida.
        </p>

        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

function getErrorDetails(error: unknown) {
  if (error instanceof Response) {
    return {
      message: `Response ${error.status}${error.url ? ` — ${error.url}` : ""}`,
      stack: "",
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message || "Error desconocido",
      stack: error.stack || "",
    };
  }

  return {
    message: String(error),
    stack: "",
  };
}

function ErrorComponent({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error("LULA SHOP OS — ERROR DE APLICACIÓN:", error);

  const router = useRouter();

  const details = getErrorDetails(error);

  useEffect(() => {
    reportLovableError(error, {
      boundary: "tanstack_root_error_component",
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl border border-destructive/30 bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-destructive">
              Error de compilación o ejecución
            </div>

            <h1 className="text-xl font-semibold tracking-tight">
              No se pudo cargar esta página
            </h1>

            <p className="text-sm text-muted-foreground">
              El sistema detectó un error. Ahora puedes ver directamente el
              detalle para localizar el problema.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <div className="mb-2 text-sm font-semibold">
                Mensaje del error
              </div>

              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-4 text-sm">
                {details.message}
              </pre>
            </div>

            {details.stack && (
              <div>
                <div className="mb-2 text-sm font-semibold">
                  Ubicación / stack
                </div>

                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-4 text-xs leading-5">
                  {details.stack}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                router.invalidate();
                reset();
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Intentar nuevamente
            </button>

            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Ir al inicio
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route =
  createRootRouteWithContext<{
    queryClient: QueryClient;
  }>()({
    head: () => ({
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: "Lula Shop OS",
        },
        {
          name: "description",
          content:
            "Sistema de punto de venta y administración de Lula Shop.",
        },
        {
          name: "author",
          content: "Lula Shop",
        },
        {
          property: "og:title",
          content: "Lula Shop OS",
        },
        {
          property: "og:description",
          content:
            "Sistema de punto de venta y administración de Lula Shop.",
        },
        {
          property: "og:type",
          content: "website",
        },
        {
          name: "twitter:card",
          content: "summary_large_image",
        },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        {
          rel: "icon",
          href: "/favicon.ico",
          type: "image/x-icon",
        },
      ],
    }),

    shellComponent: RootShell,

    component: RootComponent,

    notFoundComponent: NotFoundComponent,

    errorComponent: ErrorComponent,
  });

function RootShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="es-MX">
      <head>
        <HeadContent />
      </head>

      <body>
        {children}

        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BranchProvider>
          <Outlet />

          <Toaster position="top-right" richColors />
        </BranchProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}