-- =====================================================================
-- GALERIA VETOR DIGITAL — banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode ser executado de novo sem perder dados (idempotente).
-- =====================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Configurações institucionais (linha única, editável no painel)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                  int primary key default 1 check (id = 1),
  company_name        text not null default 'Vetor Digital',
  tagline             text default 'Fotografia esportiva',
  about               text,
  whatsapp            text default '5538997251419', -- WhatsApp da Vetor Digital (só dígitos, com DDI)
  whatsapp_message    text default 'Olá! Preciso de ajuda com a compra de fotos na Galeria Vetor Digital.',
  instagram           text default 'vetordigital.lp',
  email               text,
  cnpj                text,
  city                text,
  default_price_cents int not null default 1500 check (default_price_cents >= 100),
  watermark_text      text not null default 'VETOR DIGITAL',
  face_retention_days int not null default 90 check (face_retention_days between 1 and 365),
  updated_at          timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;
update public.settings set whatsapp = '5538997251419' where id = 1 and whatsapp is null;
-- Desconto opcional no Pix (em %, aplicado pela InfinitePay via options.discounts; exige API Key)
alter table public.settings add column if not exists pix_discount_pct numeric(5,2) not null default 0
  check (pix_discount_pct >= 0 and pix_discount_pct < 100);

-- ---------------------------------------------------------------------
-- Equipe administrativa e permissões
--   owner  = dono: tudo, inclusive gerenciar a equipe
--   admin  = tudo, menos gerenciar a equipe
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner');
$$;

-- ---------------------------------------------------------------------
-- Eventos
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name           text not null,
  category       text not null default 'Corrida de rua',
  event_date     date,
  location       text,
  description    text,
  cover_path     text,                       -- caminho no bucket previews
  price_cents    int not null default 1500 check (price_cents >= 100),
  published      boolean not null default false,
  face_search    boolean not null default true,
  faces_purge_at timestamptz,                -- quando os dados faciais serão apagados
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists events_pub_idx on public.events (published, event_date desc);

-- ---------------------------------------------------------------------
-- Fotografias
--   original_path: bucket PRIVADO "originals" (nunca público)
--   preview_path / thumb_path: bucket público "previews" (com marca-d'água)
-- ---------------------------------------------------------------------
create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  code          text not null,
  original_name text not null,
  original_path text not null,
  preview_path  text not null,
  thumb_path    text not null,
  width         int,
  height        int,
  bytes         bigint,
  price_cents   int check (price_cents is null or price_cents >= 100),  -- null = preço do evento
  published     boolean not null default true,
  faces_indexed boolean not null default false,
  face_count    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (event_id, original_name)
);
create index if not exists photos_event_idx on public.photos (event_id, code);

-- Vetores faciais das fotos (dado biométrico: acesso só por função controlada)
create table if not exists public.photo_faces (
  id         bigint generated always as identity primary key,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  embedding  extensions.vector(128) not null,
  box        jsonb,
  created_at timestamptz not null default now()
);
create index if not exists photo_faces_event_idx on public.photo_faces (event_id);
create index if not exists photo_faces_photo_idx on public.photo_faces (photo_id);

-- ---------------------------------------------------------------------
-- Clientes, pedidos e pagamentos (escrita só pelo servidor)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  customer_id       uuid references public.customers (id) on delete set null,
  status            text not null default 'pending'
                    check (status in ('pending', 'paid', 'canceled', 'failed', 'refunded')),
  total_cents       int not null check (total_cents >= 100),
  access_token_hash text not null,
  checkout_url      text,
  invoice_slug      text,
  transaction_nsu   text,
  capture_method    text,
  installments      int,
  paid_amount_cents int,
  receipt_url       text,
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id);

create table if not exists public.order_items (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders (id) on delete cascade,
  photo_id      uuid references public.photos (id) on delete set null,
  event_id      uuid references public.events (id) on delete set null,
  event_name    text,
  photo_code    text not null,
  price_cents   int not null,
  original_path text not null,
  thumb_path    text
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_photo_idx on public.order_items (photo_id);

-- Registro de auditoria de tudo que chega da InfinitePay
-- Campos adicionados para a integração com eventos da InfinitePay (seguro rodar de novo)
alter table public.orders add column if not exists payment_method_requested text;
alter table public.orders add column if not exists pix_discount_pct numeric(5,2) not null default 0;
alter table public.orders add column if not exists refunded_at timestamptz;
alter table public.orders add column if not exists canceled_at timestamptz;
alter table public.orders add column if not exists needs_review boolean not null default false;
-- Desconto progressivo por álbum e gorjeta (total_cents já inclui os dois)
alter table public.orders add column if not exists subtotal_cents int;
alter table public.orders add column if not exists discount_cents int not null default 0;
alter table public.orders add column if not exists tip_cents int not null default 0 check (tip_cents between 0 and 50000);
alter table public.orders add column if not exists pricing jsonb;
alter table public.orders add column if not exists review_note text;

create table if not exists public.payment_events (
  id         bigint generated always as identity primary key,
  order_id   uuid references public.orders (id) on delete set null,
  source     text not null,           -- webhook | redirect | admin_check
  verified   boolean not null default false,
  payload    jsonb,
  check_result jsonb,
  created_at timestamptz not null default now()
);
alter table public.payment_events add column if not exists event text;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists t_events_touch on public.events;
create trigger t_events_touch before update on public.events
  for each row execute function public.touch_updated_at();
drop trigger if exists t_orders_touch on public.orders;
create trigger t_orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
drop trigger if exists t_settings_touch on public.settings;
create trigger t_settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- Define automaticamente quando os dados faciais do evento serão apagados (LGPD)
create or replace function public.events_set_purge() returns trigger
language plpgsql security definer set search_path = public as $$
declare days int;
begin
  if new.faces_purge_at is null
     or (tg_op = 'UPDATE' and new.event_date is distinct from old.event_date
         and new.faces_purge_at = old.faces_purge_at) then
    select face_retention_days into days from public.settings where id = 1;
    new.faces_purge_at := (coalesce(new.event_date, current_date) + coalesce(days, 90))::timestamptz;
  end if;
  return new;
end $$;
drop trigger if exists t_events_purge on public.events;
create trigger t_events_purge before insert or update on public.events
  for each row execute function public.events_set_purge();

-- ---------------------------------------------------------------------
-- Segurança por linha (RLS)
-- ---------------------------------------------------------------------
alter table public.settings       enable row level security;
alter table public.admins         enable row level security;
alter table public.events         enable row level security;
alter table public.photos         enable row level security;
alter table public.photo_faces    enable row level security;
alter table public.customers      enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to anon, authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated
  using (published or public.is_admin());
drop policy if exists events_write on public.events;
create policy events_write on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists photos_read on public.photos;
create policy photos_read on public.photos for select to anon, authenticated
  using (
    public.is_admin()
    or (published and exists (select 1 from public.events e where e.id = event_id and e.published))
  );
drop policy if exists photos_write on public.photos;
create policy photos_write on public.photos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Visitante não enxerga o caminho do arquivo original, nem com consulta direta
revoke select on public.photos from anon;
grant select (id, event_id, code, preview_path, thumb_path, width, height, price_cents, published, created_at)
  on public.photos to anon;

drop policy if exists faces_admin on public.photo_faces;
create policy faces_admin on public.photo_faces for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.photo_faces from anon;

-- Clientes, pedidos e pagamentos: só leitura para a equipe; escrita só pelo servidor (service role)
drop policy if exists customers_admin on public.customers;
create policy customers_admin on public.customers for select to authenticated using (public.is_admin());
drop policy if exists orders_admin on public.orders;
create policy orders_admin on public.orders for select to authenticated using (public.is_admin());
drop policy if exists items_admin on public.order_items;
create policy items_admin on public.order_items for select to authenticated using (public.is_admin());
drop policy if exists payev_admin on public.payment_events;
create policy payev_admin on public.payment_events for select to authenticated using (public.is_admin());
revoke all on public.customers, public.orders, public.order_items, public.payment_events from anon;

-- ---------------------------------------------------------------------
-- Armazenamento de imagens
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', true, 10485760, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public, file_size_limit)
values ('originals', 'originals', false, 157286400)
on conflict (id) do update set public = false;

drop policy if exists vd_storage_admin_insert on storage.objects;
create policy vd_storage_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('previews', 'originals') and public.is_admin());
drop policy if exists vd_storage_admin_update on storage.objects;
create policy vd_storage_admin_update on storage.objects for update to authenticated
  using (bucket_id in ('previews', 'originals') and public.is_admin());
drop policy if exists vd_storage_admin_delete on storage.objects;
create policy vd_storage_admin_delete on storage.objects for delete to authenticated
  using (bucket_id in ('previews', 'originals') and public.is_admin());
drop policy if exists vd_storage_admin_read on storage.objects;
create policy vd_storage_admin_read on storage.objects for select to authenticated
  using (bucket_id in ('previews', 'originals') and public.is_admin());

-- ---------------------------------------------------------------------
-- Busca pelo rosto
-- Recebe só o vetor numérico da selfie (a foto da selfie nunca sai do
-- aparelho do atleta) e devolve apenas os IDs das fotos encontradas.
-- ---------------------------------------------------------------------
create or replace function public.search_faces(
  p_event uuid, p_embedding extensions.vector(128), p_threshold real default 0.5)
returns table (photo_id uuid, distance real)
language sql stable security definer set search_path = public, extensions as $$
  select f.photo_id, min(f.embedding <-> p_embedding)::real as distance
  from public.photo_faces f
  join public.photos p on p.id = f.photo_id and p.published
  join public.events e on e.id = f.event_id and e.published and e.face_search
  where f.event_id = p_event
    and (f.embedding <-> p_embedding) < least(greatest(coalesce(p_threshold, 0.5), 0.3), 0.6)
  group by f.photo_id
  order by 2
  limit 500;
$$;
revoke all on function public.search_faces(uuid, extensions.vector, real) from public;
grant execute on function public.search_faces(uuid, extensions.vector, real) to anon, authenticated;

-- Apaga os dados faciais de um evento (botão no painel)
create or replace function public.purge_event_faces(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.photo_faces where event_id = p_event;
  get diagnostics n = row_count;
  update public.photos set faces_indexed = false, face_count = 0 where event_id = p_event;
  return n;
end $$;

-- Apaga os dados faciais vencidos (rodado diariamente pelo agendador abaixo)
create or replace function public.purge_expired_faces() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.photo_faces f using public.events e
   where e.id = f.event_id and e.faces_purge_at is not null and e.faces_purge_at < now();
  get diagnostics n = row_count;
  update public.photos p set faces_indexed = false, face_count = 0
    from public.events e
   where e.id = p.event_id and e.faces_purge_at < now() and p.faces_indexed;
  return n;
end $$;
revoke all on function public.purge_expired_faces() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Indicadores e consultas do painel
-- ---------------------------------------------------------------------
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'photos_published', (select count(*) from public.photos p join public.events e on e.id = p.event_id
                          where p.published and e.published),
    'photos_total',     (select count(*) from public.photos),
    'events_total',     (select count(*) from public.events),
    'events_published', (select count(*) from public.events where published),
    'orders_paid',      (select count(*) from public.orders where status = 'paid'),
    'orders_pending',   (select count(*) from public.orders where status = 'pending'),
    'photos_sold',      (select count(*) from public.order_items i join public.orders o on o.id = i.order_id
                          where o.status = 'paid'),
    'revenue_cents',    (select coalesce(sum(total_cents), 0) from public.orders where status = 'paid'),
    'customers',        (select count(distinct customer_id) from public.orders where status = 'paid'),
    'top_photos', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select i.photo_id, i.photo_code as code, i.event_name as event, i.thumb_path, count(*) as sold,
               sum(i.price_cents) as revenue_cents
          from public.order_items i join public.orders o on o.id = i.order_id and o.status = 'paid'
         group by 1, 2, 3, 4 order by sold desc, revenue_cents desc limit 10) t),
    'sales_by_day', (select coalesce(jsonb_agg(t order by t.day), '[]'::jsonb) from (
        select (paid_at at time zone 'America/Sao_Paulo')::date as day, count(*) as orders,
               sum(total_cents) as revenue_cents
          from public.orders where status = 'paid' and paid_at > now() - interval '30 days'
         group by 1) t)
  );
end $$;

create or replace function public.admin_customers()
returns table (id uuid, name text, email text, phone text, orders bigint, paid_orders bigint,
               paid_total_cents bigint, last_order timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select c.id, c.name, c.email, c.phone, count(o.id),
           count(o.id) filter (where o.status = 'paid'),
           coalesce(sum(o.total_cents) filter (where o.status = 'paid'), 0)::bigint,
           max(o.created_at)
      from public.customers c left join public.orders o on o.customer_id = c.id
     group by c.id order by max(o.created_at) desc nulls last;
end $$;

create or replace function public.admin_team()
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query select a.user_id, u.email::text, a.role, a.created_at
                 from public.admins a join auth.users u on u.id = a.user_id order by a.created_at;
end $$;

-- O usuário precisa existir antes em Authentication > Users
create or replace function public.grant_admin(p_email text, p_role text default 'admin') returns text
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_owner() then raise exception 'Somente o dono pode gerenciar a equipe'; end if;
  if p_role not in ('owner', 'admin') then raise exception 'Permissão inválida'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'Usuário não encontrado. Crie o usuário em Authentication > Users no Supabase primeiro.';
  end if;
  insert into public.admins (user_id, role) values (uid, p_role)
  on conflict (user_id) do update set role = excluded.role;
  return 'ok';
end $$;

create or replace function public.revoke_admin(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Somente o dono pode gerenciar a equipe'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode remover a si mesmo'; end if;
  delete from public.admins where user_id = p_user;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------
-- Agendador diário de exclusão dos dados faciais vencidos (LGPD)
-- Requer a extensão pg_cron (Database > Extensions > pg_cron).
-- Se der erro aqui, ative o pg_cron e rode só este bloco de novo.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vd_purge_faces';
    perform cron.schedule('vd_purge_faces', '15 6 * * *', 'select public.purge_expired_faces()');
  else
    raise notice 'pg_cron não está ativo: ative em Database > Extensions e rode este bloco de novo.';
  end if;
end $$;
