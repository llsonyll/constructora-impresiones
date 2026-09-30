-- Endurecimiento según Supabase advisors (seguridad y rendimiento).

-- search_path fijo
alter function public.set_updated_at() set search_path = public;

-- Funciones de trigger: nadie las llama por la API.
revoke execute on function public.apply_stock_movement() from public, anon, authenticated;
revoke execute on function public.handle_new_user()      from public, anon, authenticated;

-- Helpers de rol: solo usuarios autenticados (las políticas RLS los necesitan).
revoke execute on function public.current_role_name()             from public, anon;
revoke execute on function public.has_role(variadic user_role[])  from public, anon;
grant  execute on function public.current_role_name()             to authenticated;
grant  execute on function public.has_role(variadic user_role[])  to authenticated;

-- Políticas: evaluar auth.uid()/has_role una vez por consulta (initplan) y
-- evitar varias políticas permisivas para la misma acción. Todas limitadas a "authenticated".
drop policy profiles_self_read  on profiles;
drop policy profiles_admin_all  on profiles;
create policy profiles_read   on profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.has_role('admin')));
create policy profiles_insert on profiles for insert to authenticated with check ((select public.has_role('admin')));
create policy profiles_update on profiles for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy profiles_delete on profiles for delete to authenticated using ((select public.has_role('admin')));

drop policy categories_read  on categories;
drop policy categories_write on categories;
create policy categories_read   on categories for select to authenticated using ((select public.has_role('admin','cajero','almacen')));
create policy categories_insert on categories for insert to authenticated with check ((select public.has_role('admin','almacen')));
create policy categories_update on categories for update to authenticated
  using ((select public.has_role('admin','almacen'))) with check ((select public.has_role('admin','almacen')));
create policy categories_delete on categories for delete to authenticated using ((select public.has_role('admin','almacen')));

drop policy products_read  on products;
drop policy products_write on products;
create policy products_read   on products for select to authenticated using ((select public.has_role('admin','cajero','almacen')));
create policy products_insert on products for insert to authenticated with check ((select public.has_role('admin','almacen')));
create policy products_update on products for update to authenticated
  using ((select public.has_role('admin','almacen'))) with check ((select public.has_role('admin','almacen')));
create policy products_delete on products for delete to authenticated using ((select public.has_role('admin','almacen')));

drop policy costs_all     on product_costs;
drop policy providers_all on providers;
drop policy po_all        on purchase_orders;
drop policy po_items_all  on purchase_order_items;
create policy costs_all     on product_costs        for all to authenticated
  using ((select public.has_role('admin','almacen'))) with check ((select public.has_role('admin','almacen')));
create policy providers_all on providers            for all to authenticated
  using ((select public.has_role('admin','almacen'))) with check ((select public.has_role('admin','almacen')));
create policy po_all        on purchase_orders      for all to authenticated
  using ((select public.has_role('admin','almacen'))) with check ((select public.has_role('admin','almacen')));
create policy po_items_all  on purchase_order_items for all to authenticated
  using ((select public.has_role('admin','almacen'))) with check ((select public.has_role('admin','almacen')));

drop policy stock_mov_read on stock_movements;
create policy stock_mov_read on stock_movements for select to authenticated using ((select public.has_role('admin','almacen')));

drop policy sales_read      on sales;
drop policy sale_items_read on sale_items;
create policy sales_read on sales for select to authenticated
  using ((select public.has_role('admin'))
         or ((select public.has_role('cajero')) and cashier_id = (select auth.uid())));
create policy sale_items_read on sale_items for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_id
                 and ((select public.has_role('admin'))
                      or ((select public.has_role('cajero')) and s.cashier_id = (select auth.uid())))));

drop policy documents_admin         on documents;
drop policy documents_cajero_read   on documents;
drop policy documents_cajero_insert on documents;
create policy documents_read on documents for select to authenticated
  using ((select public.has_role('admin'))
         or ((select public.has_role('cajero')) and created_by = (select auth.uid())));
create policy documents_insert on documents for insert to authenticated
  with check ((select public.has_role('admin'))
              or ((select public.has_role('cajero')) and created_by = (select auth.uid())));
create policy documents_update on documents for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy documents_delete on documents for delete to authenticated using ((select public.has_role('admin')));

-- Índices para claves foráneas
create index if not exists documents_created_by_idx      on documents (created_by);
create index if not exists po_items_product_idx          on purchase_order_items (product_id);
create index if not exists purchase_orders_created_by_idx on purchase_orders (created_by);
create index if not exists purchase_orders_provider_idx  on purchase_orders (provider_id);
create index if not exists sales_voided_by_idx           on sales (voided_by);
create index if not exists stock_movements_created_by_idx on stock_movements (created_by);
create index if not exists stock_movements_po_idx        on stock_movements (po_id);
create index if not exists stock_movements_sale_idx      on stock_movements (sale_id);
