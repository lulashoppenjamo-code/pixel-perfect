import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_shell/ajustes")({
  head: () => ({
    meta: [
      { title: "Ajustes — Lula Shop OS" },
      { name: "description", content: "Sucursales, usuarios y roles, y configuración general del negocio." },
      { property: "og:title", content: "Ajustes — Lula Shop OS" },
      { property: "og:description", content: "Sucursales, usuarios y roles, y configuración general del negocio." },
    ],
  }),
  component: AjustesPage,
});

const ROLES: AppRole[] = ["owner", "admin", "manager", "cashier", "staff"];

function AjustesPage() {
  const { isAdmin, isManager } = useAuth();

  return (
    <Tabs defaultValue="sucursales">
      <TabsList>
        <TabsTrigger value="sucursales">Sucursales</TabsTrigger>
        <TabsTrigger value="usuarios">Usuarios y roles</TabsTrigger>
        <TabsTrigger value="general">General</TabsTrigger>
      </TabsList>

      <TabsContent value="sucursales" className="mt-4">
        <SucursalesTab canWrite={isAdmin} />
      </TabsContent>
      <TabsContent value="usuarios" className="mt-4">
        <UsuariosTab canWrite={isAdmin} />
      </TabsContent>
      <TabsContent value="general" className="mt-4">
        <GeneralTab canWrite={isManager} />
      </TabsContent>
    </Tabs>
  );
}

type Branch = { id: string; name: string; address: string | null; phone: string | null; is_active: boolean };

function SucursalesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", address: "", phone: "" });

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });

  const createBranch = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("El nombre es obligatorio");
      const { error } = await supabase.from("branches").insert({
        name: form.name,
        address: form.address || null,
        phone: form.phone || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sucursal creada");
      setForm({ name: "", address: "", phone: "" });
      void qc.invalidateQueries({ queryKey: ["branches-admin"] });
      void qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo crear"),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("branches").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["branches-admin"] });
      void qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo actualizar"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Sucursales</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Activa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="text-muted-foreground">{b.address || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{b.phone || "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={b.is_active}
                      disabled={!canWrite}
                      onCheckedChange={(v) => toggleActive.mutate({ id: b.id, is_active: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!branches.length && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No hay sucursales todavía.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canWrite && (
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nueva sucursal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <Button className="w-full" disabled={createBranch.isPending} onClick={() => createBranch.mutate()}>
              <Plus className="size-4" /> Crear sucursal
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type ProfileRow = { id: string; full_name: string | null; is_active: boolean };
type UserRoleRow = { id: string; user_id: string; role: AppRole };

function UsuariosTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [pickUser, setPickUser] = useState("");
  const [pickRole, setPickRole] = useState<AppRole>("staff");

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, is_active").order("full_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["user-roles-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("id, user_id, role");
      if (error) throw error;
      return (data ?? []) as UserRoleRow[];
    },
  });

  const rolesByUser = (uid: string) => roles.filter((r) => r.user_id === uid);

  const addRole = useMutation({
    mutationFn: async () => {
      if (!pickUser) throw new Error("Selecciona un usuario");
      const { error } = await supabase.from("user_roles").insert({ user_id: pickUser, role: pickRole });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rol asignado");
      void qc.invalidateQueries({ queryKey: ["user-roles-admin"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo asignar (¿ya lo tiene?)"),
  });

  const removeRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rol quitado");
      void qc.invalidateQueries({ queryKey: ["user-roles-admin"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo quitar"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Roles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.full_name || "Sin nombre"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rolesByUser(p.id).map((r) => (
                        <Badge key={r.id} variant="secondary" className="flex items-center gap-1">
                          {r.role}
                          {canWrite && (
                            <button onClick={() => removeRole.mutate(r.id)} aria-label="Quitar rol">
                              <Trash2 className="size-3" />
                            </button>
                          )}
                        </Badge>
                      ))}
                      {!rolesByUser(p.id).length && <span className="text-xs text-muted-foreground">Sin rol</span>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!profiles.length && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                    Todavía no hay usuarios registrados (aparecen aquí tras su primer inicio de sesión).
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canWrite && (
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Asignar rol</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Usuario</Label>
              <Select value={pickUser} onValueChange={setPickUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un usuario" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name || p.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={pickRole} onValueChange={(v) => setPickRole(v as AppRole)}>
                <SelectTrigger>
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
            </div>
            <Button className="w-full" disabled={addRole.isPending} onClick={() => addRole.mutate()}>
              <Plus className="size-4" /> Asignar
            </Button>
            <p className="text-xs text-muted-foreground">
              Los usuarios nuevos aparecen en la lista después de iniciar sesión por primera vez.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GeneralTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [storeName, setStoreName] = useState("");
  const [taxRate, setTaxRate] = useState("0.16");

  const { data: settings } = useQuery({
    queryKey: ["settings-general"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key, value")
        .is("branch_id", null)
        .in("key", ["store_name", "default_tax_rate"]);
      if (error) throw error;
      const map = new Map((data ?? []).map((s) => [s.key, s.value]));
      const name = map.get("store_name");
      const rate = map.get("default_tax_rate");
      if (typeof name === "string") setStoreName(name);
      if (typeof rate === "number") setTaxRate(String(rate));
      return data ?? [];
    },
  });

  const upsertGlobalSetting = async (key: string, value: string | number) => {
    const { data: existing, error: e1 } = await supabase
      .from("settings")
      .select("id")
      .is("branch_id", null)
      .eq("key", key)
      .maybeSingle();
    if (e1) throw e1;
    if (existing) {
      const { error } = await supabase.from("settings").update({ value }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("settings").insert({ branch_id: null, key, value });
      if (error) throw error;
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      await upsertGlobalSetting("store_name", storeName);
      await upsertGlobalSetting("default_tax_rate", Number(taxRate));
    },
    onSuccess: () => {
      toast.success("Configuración guardada");
      void qc.invalidateQueries({ queryKey: ["settings-general"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label>Nombre del negocio</Label>
          <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="space-y-2">
          <Label>Tasa de impuesto por defecto</Label>
          <Input
            type="number"
            step="0.01"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            disabled={!canWrite}
          />
        </div>
        {canWrite && (
          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        )}
        {!canWrite && <p className="text-xs text-muted-foreground">Tu rol no puede editar la configuración.</p>}
        {!settings?.length && <p className="text-xs text-muted-foreground">Aún sin configuración guardada.</p>}
      </CardContent>
    </Card>
  );
}