-- Archi Field — skema inti (sudah diterapkan ke proyek Supabase "archifield").
-- File ini adalah catatan lengkap kondisi akhir; jangan dijalankan ulang di proyek yang sama.

-- Profil pengguna (terhubung ke auth.users lewat email)
create table public.profiles (
  app_id text primary key,               -- id di aplikasi: ray, nadia, dimas, ...
  user_id uuid unique references auth.users(id) on delete set null,
  email text unique,
  nama text not null,
  role text not null check (role in ('approver','bm','admin','md','spg')),
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

-- Semua data aplikasi sebagai record JSON per koleksi
create table public.app_records (
  coll text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index app_records_updated_at on public.app_records (updated_at);

-- Helper di skema private (tidak terekspos API)
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and aktif
$$;
create or replace function private.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('approver','bm','admin') from public.profiles where user_id = auth.uid() and aktif), false)
$$;
revoke all on function private.my_role() from public, anon;
revoke all on function private.is_manager() from public, anon;
grant execute on function private.my_role() to authenticated;
grant execute on function private.is_manager() to authenticated;

-- Jam server (untuk jam foto/absen yang tidak bisa diakali dari HP)
create or replace function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;
revoke execute on function public.server_now() from anon;

-- Stempel waktu & pembuat selalu dari server
create or replace function public.touch_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now();
  else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
revoke all on function public.touch_record() from public, anon, authenticated;
create trigger app_records_touch before insert or update on public.app_records
for each row execute function public.touch_record();

-- Hubungkan akun login baru ke profil berdasarkan email; akun pertama = Pemilik
create or replace function private.link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  if not found and not exists (select 1 from public.profiles where role='approver' and user_id is not null) then
    update public.profiles set user_id = new.id, email = coalesce(email, new.email)
     where app_id = (select app_id from public.profiles where role='approver' and user_id is null order by app_id limit 1);
  end if;
  return new;
end $$;
revoke all on function private.link_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.link_profile();

-- RLS
alter table public.profiles enable row level security;
alter table public.app_records enable row level security;

create policy "profil dibaca pengguna aktif" on public.profiles
  for select to authenticated using (private.my_role() is not null);
create policy "profil dikelola manajemen" on public.profiles
  for all to authenticated using (private.is_manager()) with check (private.is_manager());

create policy "data dibaca pengguna aktif" on public.app_records
  for select to authenticated using (private.my_role() is not null);
create policy "manajemen tulis semua" on public.app_records
  for all to authenticated using (private.is_manager()) with check (private.is_manager());
create policy "lapangan tambah data operasional" on public.app_records
  for insert to authenticated
  with check (private.my_role() in ('md','spg')
    and coll in ('visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap','audits'));
create policy "lapangan ubah data operasional" on public.app_records
  for update to authenticated
  using (private.my_role() in ('md','spg')
    and coll in ('visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap')
    and not deleted)
  with check (private.my_role() in ('md','spg')
    and coll in ('visits','spgDays','tickets','tasks','lokReq','proposals','excuses','counts','returns','deliveries','invoices','tagihan','spgReported','log','seen','snap')
    and (not deleted or created_by = auth.uid()));

-- Realtime
alter publication supabase_realtime add table public.app_records;

-- Storage foto (privat, maks 3 MB per foto)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos','photos', false, 3145728, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;
create policy "foto dibaca pengguna aktif" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and private.my_role() is not null);
create policy "foto diunggah ke folder sendiri" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and private.my_role() is not null
              and (storage.foldername(name))[1] = auth.uid()::text);

-- Tim awal
insert into public.profiles(app_id,nama,role) values
 ('ray','Ray','approver'),('nadia','Nadia','bm'),('wulan','Wulan','admin'),
 ('dimas','Dimas','md'),('bagas','Bagas','md'),('yoga','Yoga','md'),
 ('sari','Sari','spg'),('rina','Rina','spg')
on conflict do nothing;
create policy "foto diperbarui di folder sendiri" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
