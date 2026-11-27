{
  "timestamp": 1795811551700,
  "error_type": "RUNTIME_ERROR",
  "filename": "Unknown file",
  "lineno": 0,
  "colno": 0,
  "stack": "Unavailable",
  "has_blank_screen": true
}

ty(e.target.value)}
                        className="h-12 flex-1 rounded-xl border-[#e0e0e0] text-center text-lg font-semibold"
                      />
                      <button
                        type="button"
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#34a853] text-2xl font-bold text-white"
                        onClick={() => {
                          const q = (Number(editQty) || 0) + 1;
                          setEditQty(String(q));
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#eeeeee] bg-white p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#212121]">
                        Aplicar oferta
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editOfferOn}
                        onClick={() => setEditOfferOn((v) => !v)}
                        className={
                          "relative h-7 w-12 rounded-full transition " +
                          (editOfferOn ? "bg-[#1a73e8]" : "bg-[#cfd8dc]")
                        }
                      >
                        <span
                          className={
                            "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition " +
                            (editOfferOn ? "left-5" : "left-0.5")
                          }
                        />
                      </button>
                    </div>

                    {editOfferOn && (
                      <div className="mt-3 space-y-3">
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              checked={editOfferMode === "discount"}
                              onChange={() => setEditOfferMode("discount")}
                            />
                            Dar descuento
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              checked={editOfferMode === "free"}
                              onChange={() => setEditOfferMode("free")}
                            />
                            Dar como gratis
                          </label>
                        </div>

                        {editOfferMode === "discount" && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="flex items-center rounded-xl border border-[#e0e0e0] bg-[#f5f5f5] px-2">
                                <span className="text-sm text-[#757575]">%</span>
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={editPct}
                                  onChange={(e) => {
                                    setEditPct(e.target.value);
                                    setEditAmount("");
                                  }}
                                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                                />
                              </div>
                              <p className="mt-1 text-[11px] text-[#9e9e9e]">
                                Por porcentaje
                              </p>
                            </div>
                            <div>
                              <div className="flex items-center rounded-xl border border-[#e0e0e0] bg-[#f5f5f5] px-2">
                                <span className="text-sm text-[#757575]">$</span>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={editAmount}
                                  onChange={(e) => {
                                    setEditAmount(e.target.value);
                                    setEditPct("");
                                  }}
                                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                                />
                              </div>
                              <p className="mt-1 text-[11px] text-[#9e9e9e]">
                                Por precio (por artículo)
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-[#eeeeee] p-4">
                  <button
                    type="button"
                    onClick={applyEditLine}
                    className="flex h-12 w-full items-center justify-center rounded-xl bg-[#34a853] text-[15px] font-bold text-white shadow-md active:scale-[0.98]"
                  >
                    Actualizar artículo
                  </button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ventas recientes</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2 pr-2">
              {recentSales.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Sin ventas recientes
                </p>
              ) : (
                recentSales.map((sale) => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">
                        Folio #{sale.folio}{" "}
                        <Badge variant="outline" className="ml-1 text-xs">
                          {sale.status}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(sale.created_at).toLocaleString("es-MX")} ·{" "}
                        {sale.payment_method} · {money(Number(sale.total))}
                      </p>
                    </div>

                    <div className="flex flex-col gap-1.5 sm:flex-row">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reprintSale.isPending}
                        onClick={() => reprintSale.mutate(sale.id)}
                      >
                        <Printer className="mr-1 h-3.5 w-3.5" />
                        Ticket
                      </Button>

                      {sale.status === "completed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={cancelSale.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              `Motivo de cancelación del folio #${sale.folio} (opcional):`,
                              "Error de cobro",
                            );
                            if (reason === null) return;

                          if (
                              !window.confirm(
                                `¿Cancelar la venta #${sale.folio}? Se restaurará el stock.`,
                              )
                            ) {
                              return;
                            }
                            cancelSale.mutate({
                              saleId: sale.id,
                              reason: reason.trim() || undefined,
                            });
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {mobileStep === "pay" && (
        <div className={cn("fixed inset-0 z-50 flex flex-col bg-[#f5f5f5]", !sequential && "hidden")}>
          <div className="bg-[#1a73e8] px-3 pb-3 pt-3 text-white">
            <button
              type="button"
              onClick={() => setMobileStep("cart")}
              className="mb-2 flex items-center gap-1 text-sm font-medium text-white/90"
            >
              ← Volver
            </button>
            <p className="text-center text-sm font-bold uppercase tracking-wide">
              DETALLES DEL CLIENTE (OPCIONAL)
            </p>
          </div>

          <div className="space-y-3 overflow-y-auto p-3 pb-8">
            <div className="rounded-xl border border-[#e0e0e0] bg-white p-3 shadow-sm">
              <p className="mb-2 text-xs font-medium text-[#757575]">
                Buscar cliente por nombre, teléfono o código
              </p>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9e9e9e]" />
                  <Input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (selectCustomerByCode(customerSearch)) return;
                      if (filteredCustomers.length === 1) {
                        const only = filteredCustomers[0]!;
                        setCustomerId(only.id);
                        setCustomerSearch(only.name);
                        toast.success(`Cliente: ${only.name}`);
                      }
                    }}
                    placeholder="Nombre, teléfono o escanear tarjeta…"
                    className="h-11 rounded-xl border-[#e0e0e0] pl-9"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </div>
                <button
                  type="button"
                  title="Escanear tarjeta del cliente"
                  onClick={() => setScannerOpen(true)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e0e0e0] bg-white text-[#1a73e8]"
                >
                  <ScanBarcode className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>

              {customerId !== "none" && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-[#e8f0fe] px-3 py-2">
                  <span className="text-sm font-semibold text-[#1a73e8]">
                    {customers.find((c) => c.id === customerId)?.name ??
                      "Cliente seleccionado"}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#e53935]"
                    onClick={() => {
                      setCustomerId("none");
                      setCustomerSearch("");
                    }}
                  >
                    Quitar
                  </button>
                </div>
              )}

              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-[#eeeeee]">
                <button
                  type="button"
                  onClick={() => {
                    setCustomerId("none");
                    setCustomerSearch("");
                  }}
                  className={
                    "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm " +
                    (customerId === "none"
                      ? "bg-[#e8f0fe] font-semibold text-[#1a73e8]"
                      : "text-[#212121] active:bg-[#f5f5f5]")
                  }
                >
                  Público general
                  {customerId === "none" ? <span>✓</span> : null}
                </button>
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id);
                      setCustomerSearch(c.name);
                    }}
                    className={
                      "flex w-full flex-col border-t border-[#f0f0f0] px-3 py-2.5 text-left active:bg-[#f5f5f5] " +
                      (customerId === c.id ? "bg-[#e8f0fe]" : "")
                    }
                  >
                    <span
                      className={
                        "text-sm " +
                        (customerId === c.id
                          ? "font-semibold text-[#1a73e8]"
                          : "font-medium text-[#212121]")
                      }
                    >
                      {c.name}
                    </span>
                    {(c.phone || c.barcode) && (
                      <span className="text-[11px] text-[#9e9e9e]">
                        {[c.phone, c.barcode].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </button>
                ))}
                {customerSearch.trim() && filteredCustomers.length === 0 && (
                  <p className="border-t border-[#f0f0f0] px-3 py-3 text-center text-xs text-[#9e9e9e]">
                    Sin coincidencias. Prueba nombre, teléfono o código de la
                    tarjeta.
                  </p>
                )}
              </div>
            </div>

            <p className="px-1 text-center text-sm font-semibold text-[#1a73e8]">
              Seleccione el método de pago
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  { id: "cash" as const, label: "Efectivo", emoji: "💵" },
                  { id: "card" as const, label: "Tarjeta de débito", emoji: "💳" },
                  { id: "card" as const, label: "Tarjeta de crédito", emoji: "💳", key: "card2" },
                  { id: "credit" as const, label: "Crédito", emoji: "📅" },
                  { id: "transfer" as const, label: "Transferencia", emoji: "T" },
                  { id: "mixed" as const, label: "Mixto", emoji: "🔀" },
                ] as const
              ).map((item, i) => (
                <button
                  key={`${item.id}-${i}`}
                  type="button"
                  onClick={() => {
                    setMethod(item.id);
                    if (item.id === "cash") {
                      setCashReceived(total > 0 ? String(total.toFixed(2)) : "");
                      setMobileStep("cash");
                    } else if (item.id === "mixed") {
                      setMixedCash("");
                      setMixedCard("");
                      setMobileStep("mixed");
                    } else {
                      if (submittingRef.current || checkout.isPending) return;
                      checkout.mutate(item.id);
                    }
                  }}
                  className="flex flex-col items-center justify-center rounded-xl border border-[#e0e0e0] bg-white p-4 text-center shadow-sm active:scale-[0.98]"
                >
                  <span className="text-2xl">{item.emoji}</span>
                  <span className="mt-1 text-sm font-semibold text-[#212121]">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

ify-center gap-2 rounded-xl border border-[#e0e0e0] bg-[#eeeeee] px-3 py-7 text-center shadow-sm active:scale-[0.97]"
                >
                  {item.id === "transfer" || item.id === "mixed" ? (
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#1a73e8] text-lg font-bold text-white">
                      {item.emoji}
                    </span>
                  ) : (
                    <span className="text-3xl">{item.emoji}</span>
                  )}
                  <span className="text-sm font-semibold text-[#212121]">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {mobileStep === "cash" && (
        <div className={cn("fixed inset-0 z-50 flex flex-col bg-[#f5f5f5]", !sequential && "hidden")}>
          <div className="flex items-center gap-2 bg-[#1a73e8] px-3 py-3 text-white">
            <button
              type="button"
              onClick={() => setMobileStep("pay")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl"
            >
              ←
            </button>
            <h1 className="flex-1 text-lg font-bold">Efectivo</h1>
          </div>

          <div className="flex-1 space-y-0 overflow-y-auto p-3">
            <div className="overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
                <span className="text-sm text-[#757575]">Gran total</span>
                <span className="text-sm font-semibold text-[#212121]">
                  {money(total)}
                </span>
              </div>

              <div className="px-4 py-5 text-center">
                <p className="text-sm text-[#9e9e9e]">
                  Efectivo recibido (opcional)
                </p>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="mx-auto mt-2 h-14 max-w-[200px] border-0 bg-transparent text-center text-4xl font-bold text-[#212121] shadow-none focus-visible:ring-0"
                  placeholder={String(total.toFixed(0))}
                />
              </div>

              <div
                className={cn(
                  "px-4 py-4 text-center",
                  cashNum > 0 && cashNum >= total
                    ? "bg-[#e8f5e9]"
                    : "bg-[#e3f2fd]",
                )}
              >
                <p
                  className={cn(
                    "text-sm",
                    cashNum > 0 && cashNum >= total
                      ? "text-[#2e7d32]"
                      : "text-[#64b5f6]",
                  )}
                >
                  {cashNum > 0 && cashNum >= total ? "Cambio a Dar" : "Cambio"}
                </p>
                <p
                  className={cn(
                    "mt-1 text-3xl font-bold",
                    cashNum > 0 && cashNum >= total
                      ? "text-[#2e7d32]"
                      : "text-[#90caf9]",
                  )}
                >
                  {money(cashNum > 0 && cashNum >= total ? cashNum - total : 0)}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 px-2">
              {[20, 50, 100, 200, 500, 1000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    const current = Number(cashReceived) || 0;
                    const prefilled =
                      total > 0 && Math.abs(current - total) < 0.001;
                    if (current === 0 || prefilled) {
                      setCashReceived(String(amount));
                    } else {
                      setCashReceived(String(current + amount));
                    }
                  }}
                  className="rounded-full border border-[#bdbdbd] bg-white py-2.5 text-sm font-medium text-[#424242] shadow-sm active:bg-[#f5f5f5]"
                >
                  +${amount}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[#e0e0e0] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              disabled={!canSell || checkout.isPending}
              onClick={() => {
                if (submittingRef.current || checkout.isPending) return;
                checkout.mutate("cash");
              }}
              className="flex h-12 w-full items-center justify-center rounded-md bg-[#4caf50] text-base font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-50"
            >
              {checkout.isPending ? "Procesando…" : "Recibido por Efectivo"}
            </button>
          </div>
        </div>
      )}

      {mobileStep === "mixed" && (
        <div className={cn("fixed inset-0 z-50 flex flex-col bg-[#f5f5f5]", !sequential && "hidden")}>
          <div className="flex items-center gap-2 bg-[#1a73e8] px-3 py-3 text-white">
            <button
              type="button"
              onClick={() => setMobileStep("pay")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl"
            >
              ←
            </button>
            <h1 className="flex-1 text-lg font-bold">Pago mixto</h1>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            <div className="overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
                <span className="text-sm text-[#757575]">Gran total</span>
                <span className="text-sm font-semibold text-[#212121]">
                  {money(total)}
                </span>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div>
                  <label className="text-sm text-[#757575]">Efectivo</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={mixedCash}
                    onChange={(e) => setMixedCash(e.target.value)}
                    className="mt-1 h-12 rounded-xl border-[#e0e0e0] text-lg font-semibold"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="text-sm text-[#757575]">Tarjeta</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={mixedCard}
                    onChange={(e) => setMixedCard(e.target.value)}
                    className="mt-1 h-12 rounded-xl border-[#e0e0e0] text-lg font-semibold"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="border-t border-[#f0f0f0] px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#757575]">Total aplicado</span>
                  <span className="font-semibold text-[#212121]">
                    {money(
                      (Number(mixedCash) || 0) + (Number(mixedCard) || 0),
                    )}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-[#757575]">
                    {(Number(mixedCash) || 0) + (Number(mixedCard) || 0) >=

         total - 0.01
                      ? "Cubierto"
                      : "Falta"}
                  </span>
                  <span
                    className={
                      (Number(mixedCash) || 0) + (Number(mixedCard) || 0) >=
                      total - 0.01
                        ? "font-semibold text-[#2e7d32]"
                        : "font-semibold text-[#c62828]"
                    }
                  >
                    {money(
                      Math.max(
                        0,
                        total -
                          ((Number(mixedCash) || 0) +
                            (Number(mixedCard) || 0)),
                      ),
                    )}
                  </span>
                </div>
              </div>
            </div>

            <p className="px-1 text-center text-xs text-[#9e9e9e]">
              La suma de efectivo y tarjeta debe cubrir el total de la venta.
            </p>
          </div>

          <div className="border-t border-[#e0e0e0] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              disabled={
                !canSell ||
                checkout.isPending ||
                (Number(mixedCash) || 0) + (Number(mixedCard) || 0) <
                  total - 0.01
              }
              onClick={() => {
                if (submittingRef.current || checkout.isPending) return;
                checkout.mutate("mixed");
              }}
              className="flex h-12 w-full items-center justify-center rounded-md bg-[#4caf50] text-base font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-50"
            >
              {checkout.isPending ? "Procesando…" : "Confirmar cobro mixto"}
            </button>
          </div>
        </div>
      )}

      {mobileStep === "success" && (
        <div className={cn("fixed inset-0 z-50 flex flex-col bg-white", !sequential && "hidden")}>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#66bb6a] text-[#66bb6a]"
              style={{
                animation: "lulaCheckPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-10 w-10"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                style={{
                  strokeDasharray: 30,
                  strokeDashoffset: 30,
                  animation: "lulaCheckDraw 0.35s ease-out 0.15s forwards",
                }}
              >
                <path
                  d="M5 13l4 4L19 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p
              className="text-4xl font-bold text-[#1a73e8]"
              style={{
                animation: "lulaFadeUp 0.4s ease-out 0.2s both",
              }}
            >
              {money(lastSaleTotal)}
            </p>
            <style>{`
              @keyframes lulaCheckPop {
                0% { transform: scale(0.3); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
              }
              @keyframes lulaCheckDraw {
                to { stroke-dashoffset: 0; }
              }
              @keyframes lulaFadeUp {
                0% { opacity: 0; transform: translateY(8px); }
                100% { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>

          <div className="space-y-2 border-t border-[#eee] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <p className="mb-2 text-center text-xs text-[#9e9e9e]">
              ID DE RECIBO: LULA-{lastSaleFolio} · ARTÍCULOS cobrados
            </p>
            <button
              type="button"
              onClick={() => setTicketOpen(true)}
              className="flex h-12 w-full items-center justify-center rounded-md bg-[#66bb6a] text-base font-bold uppercase tracking-wide text-white"
            >
              OBTENER RECIBO
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileStep("shop");
                setTicketOpen(false);
              }}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-[#34a853] text-base font-bold uppercase tracking-wide text-white shadow-sm active:scale-[0.98]"
            >
              NUEVA VENTA
            </button>
          </div>
        </div>
      )}

      <ParkedSalesDialog
        open={parkedSalesOpen}
        onOpenChange={setParkedSalesOpen}
        branchId={branchId}
        onRecover={recoverParkedSale}
      />

      <TicketModal
        open={ticketOpen}
        onOpenChange={setTicketOpen}
        ticket={ticket}
      />
    </div>
  );
}
