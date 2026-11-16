-- Peran Sales (canvassing Horeca & outlet independen) — diterapkan saat modul Sales disetujui
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('approver','bm','admin','md','spg','sales'));
drop policy "lapangan tambah data operasional" on public.app_records;
create policy "lapangan tambah data operasional" on public.app_records
  for insert to authenticated
  with check (private.my_role() in ('md','spg','sales')
    and coll in ('visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap','audits','customers','salesPlans','salesVisits','orders'));
drop policy "lapangan ubah data operasional" on public.app_records;
create policy "lapangan ubah data operasional" on public.app_records
  for update to authenticated
  using (private.my_role() in ('md','spg','sales')
    and coll in ('visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap','customers','salesPlans','salesVisits','orders')
    and not deleted)
  with check (private.my_role() in ('md','spg','sales')
    and coll in ('visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap','customers','salesPlans','salesVisits','orders')
    and (not deleted or created_by = auth.uid()));
