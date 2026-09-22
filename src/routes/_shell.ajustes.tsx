// ============================================================================
// RUTA: src/routes/_shell.ajustes.tsx
// Copia TODO lo de abajo (sin estas 4 líneas de comentario) a: src/routes/_shell.ajustes.tsx
// ============================================================================

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageShell } from "@/components/PageHeader";

export const Route = createFileRoute("/_shell/ajustes")({
  head: () => ({
    meta: [
      { title: "Ajustes — Lula Shop OS" },
      { name: "description", content: "Administra sucursales, usuarios y roles, y la configuración general del negocio." },
      { property: "og:title", content: "Ajustes — Lula Shop OS" },
      { property: "og:description", content: "Administra sucursales, usuarios y roles, y la configuración general del negocio." },
    ],
  }),
  component: AjustesPage,
});

const ROLES: AppRole[] = ["owner", "admin", "manager", "cashier", "staff"];

function AjustesPage() {
  const { isAdmin, isManager } = useAuth();
  const { branches, branchId } = useBranch();
  const qc = useQueryClient();
  const [branch, setBranch] = useState({ name: "", address: "", phone: "" });
  const [setting, setSetting] = useState({ key: "", value: "" });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const [{ data: p, error }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, branch_id, is_active"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      return (p ?? []).map((x) => ({
        ...x,
        roles: (r ?? []).filter((y) => y.user_id === x.id).map((y) => y.role as AppRole),
      }));
    },
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").order("key");
      if (error) throw error;
      return data ?? [];
    },
  });

  const createBranch = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("branches").insert({
        name: branch.name,
        address: branch.address || null,
        phone: branch.phone || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sucursal creada");
      setBranch({ name: "", address: "", phone: "" });
      void qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo crear"),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error: del } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (del) throw del;
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rol actualizado");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo actualizar"),
  });

  const setUserBranch = useMutation({
    mutationFn: async ({ userId, bid }: { userId: string; bid: string }) => {
      const { error } = await supabase.from("profiles").update({ branch_id: bid }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sucursal asignada");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo asignar"),
  });

  const saveSetting = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(setting.value);
      } catch {
        parsed = setting.value;
      }
      const { error } = await supabase
        .from("settings")
        .upsert({ branch_id: branchId, key: setting.key, value: parsed as never }, { onConflict: "branch_id,key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuración guardada");
      setSetting({ key: "", value: "" });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <PageShell>
      <PageHeader
        icon={Settings}
        title="Ajustes"
        description="Sucursales, usuarios, roles y configuración general del negocio."
      />
    <Tabs defaultValue="sucursales" className="space-y-4">
      <TabsList>
        <TabsTrigger value="sucursales">Sucursales</TabsTrigger>
        <TabsTrigger value="usuarios">Usuarios y roles</TabsTrigger>
        <TabsTrigger value="general">General</TabsTrigger>
      </TabsList>

      <TabsContent value="sucursales" className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Sucursales</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Teléfono</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.name}</TableCell>
                    <TableCell>{b.address ?? "—"}</TableCell>
                    <TableCell>{b.phone ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {!branches.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      Crea tu primera sucursal para empezar a vender.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nueva sucursal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isAdmin && <p className="text-sm text-muted-foreground">Solo dueño o admin pueden crear sucursales.</p>}
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input value={branch.phone} onChange={(e) => setBranch({ ...branch, phone: e.target.value })} />
            </div>
            <Button className="w-full" disabled={!isAdmin || !branch.name} onClick={() => createBranch.mutate()}>
              Crear
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="usuarios">
        <Card>
          <CardHeader>
            <CardTitle>Usuarios</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Sucursal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.full_name ?? "Sin nombre"}</TableCell>
                    <TableCell>
                      <Select
                        value={p.roles[0] ?? "staff"}
                        onValueChange={(v) => setRole.mutate({ userId: p.id, role: v as AppRole })}
                        disabled={!isAdmin}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={p.branch_id ?? ""}
                        onValueChange={(v) => setUserBranch.mutate({ userId: p.id, bid: v })}
                        disabled={!isAdmin}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue placeholder="Sin asignar" />
                        </SelectTrigger>
                        <SelectContent>
                          {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="general" className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clave</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Alcance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.key}</TableCell>
                    <TableCell className="max-w-xs truncate">{JSON.stringify(s.value)}</TableCell>
                    <TableCell>{s.branch_id ? branches.find((b) => b.id === s.branch_id)?.name : "Global"}</TableCell>
                  </TableRow>
                ))}
                {!settings.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      Sin configuración guardada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nuevo ajuste</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Clave</Label>
              <Input value={setting.key} onChange={(e) => setSetting({ ...setting, key: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input value={setting.value} onChange={(e) => setSetting({ ...setting, value: e.target.value })} />
            </div>
            <Button className="w-full" disabled={!isManager || !setting.key} onClick={() => saveSetting.mutate()}>
              Guardar
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
    </PageShell>
  );
}
