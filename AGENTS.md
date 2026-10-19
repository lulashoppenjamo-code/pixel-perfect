<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Inventory import parsing and action filtering live in `src/lib/productImport.ts`; both import entry points use the same panel to avoid divergent writes.
- Import writes require an empty, read-only `bulk_import_products` preflight returning `import_contract=selective-v1`; old RPCs overwrite omitted fields and must not receive selective payloads.
- The proposed SQL contract is outside migrations and must remain unapplied until approved and operational `shared_inventory` is verified; never substitute legacy inventory.
- Product image presentation uses `ProductImage` for contain sizing and load-error fallback; device uploads require verified Storage infrastructure, not a presumed bucket.
