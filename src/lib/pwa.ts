type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

const installListeners = new Set<() => void>();

function notifyInstallListeners() {
  for (const listener of installListeners) {
    listener();
  }
}

export function initializePwa() {
  if (typeof window === "undefined") {
    return;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
        })
        .then((registration) => {
          console.info(
            "LULA SHOP OS — Service Worker registrado:",
            registration.scope,
          );
        })
        .catch((error) => {
          console.error(
            "LULA SHOP OS — Error registrando Service Worker:",
            error,
          );
        });
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();

    deferredInstallPrompt = event as BeforeInstallPromptEvent;

    notifyInstallListeners();

    console.info("LULA SHOP OS — Instalación PWA disponible.");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;

    notifyInstallListeners();

    console.info("LULA SHOP OS — Aplicación instalada.");
  });
}

export function canInstallPwa(): boolean {
  return deferredInstallPrompt !== null;
}

export async function installPwa(): Promise<boolean> {
  if (!deferredInstallPrompt) {
    return false;
  }

  const promptEvent = deferredInstallPrompt;

  deferredInstallPrompt = null;

  try {
    await promptEvent.prompt();

    const result = await promptEvent.userChoice;

    notifyInstallListeners();

    return result.outcome === "accepted";
  } catch (error) {
    console.error(
      "LULA SHOP OS — Error durante instalación:",
      error,
    );

    notifyInstallListeners();

    return false;
  }
}

export function isPwaInstalled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }

  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };

  return navigatorWithStandalone.standalone === true;
}

export function subscribePwaInstall(
  listener: () => void,
): () => void {
  installListeners.add(listener);

  return () => {
    installListeners.delete(listener);
  };
}