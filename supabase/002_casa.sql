-- Estante · parte 2: convite, curtidas, comentários, leitura da casa e capas.
-- Cole tudo no SQL Editor do Supabase e clique em Run. Pode rodar de novo sem problema.

-- ---------- Convite: só entra na casa quem tem o código ----------
create table if not exists house (
  id int primary key default 1 check (id = 1),
  invite_code text not null
);
alter table house enable row level security; -- sem políticas: só as funções abaixo leem
insert into house (id, invite_code)
values (1, 'casa-' || substr(md5(random()::text), 1, 6))
on conflict (id) do nothing;

alter table profiles add column if not exists is_admin boolean not null default false;
-- Quem abriu a ficha primeiro é o dono da casa.
update profiles set is_admin = true
where id = (select id from profiles order by created_at limit 1)
  and not exists (select 1 from profiles where is_admin);

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function join_house(code text, uname text, dname text) returns profiles
language plpgsql security definer set search_path = public as $$
declare
  p profiles;
  first boolean;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into p from profiles where id = auth.uid();
  if found then return p; end if;
  first := not exists (select 1 from profiles);
  if not first and lower(trim(coalesce(code, ''))) <> (select lower(invite_code) from house where id = 1) then
    raise exception 'invite_invalid';
  end if;
  insert into profiles (id, username, display_name, is_admin)
  values (auth.uid(), lower(trim(uname)), trim(dname), first)
  returning * into p;
  return p;
end $$;

create or replace function get_invite() returns text
language sql stable security definer set search_path = public as $$
  select case when is_admin() then (select invite_code from house where id = 1) end;
$$;

create or replace function set_invite(code text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not_admin'; end if;
  if length(trim(code)) < 6 then raise exception 'invite_short'; end if;
  update house set invite_code = trim(code) where id = 1;
  return trim(code);
end $$;

-- Perfis e estantes: só membros da casa enxergam.
drop policy if exists "perfis visíveis a logados" on profiles;
drop policy if exists "edita o próprio perfil" on profiles;
drop policy if exists "membros veem perfis" on profiles;
drop policy if exists "atualiza o próprio perfil" on profiles;
create policy "membros veem perfis" on profiles for select to authenticated using (is_member());
create policy "atualiza o próprio perfil" on profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
revoke insert, update on profiles from authenticated;
grant update (display_name) on profiles to authenticated;

drop policy if exists "estantes visíveis a logados" on shelves;
drop policy if exists "membros veem estantes" on shelves;
create policy "membros veem estantes" on shelves for select to authenticated using (is_member());

-- ---------- Curtidas e comentários nas resenhas ----------
create table if not exists review_likes (
  owner_id uuid not null references profiles on delete cascade,
  review_id text not null,
  user_id uuid not null default auth.uid() references profiles on delete cascade,
  created_at timestamptz default now(),
  primary key (owner_id, review_id, user_id)
);
create table if not exists review_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles on delete cascade,
  review_id text not null,
  user_id uuid not null default auth.uid() references profiles on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz default now()
);
alter table review_likes enable row level security;
alter table review_comments enable row level security;
drop policy if exists "membros veem curtidas" on review_likes;
drop policy if exists "curte como si" on review_likes;
drop policy if exists "descurte o que curtiu" on review_likes;
create policy "membros veem curtidas" on review_likes for select to authenticated using (is_member());
create policy "curte como si" on review_likes for insert to authenticated with check (user_id = auth.uid() and is_member());
create policy "descurte o que curtiu" on review_likes for delete to authenticated using (user_id = auth.uid());
drop policy if exists "membros veem comentários" on review_comments;
drop policy if exists "comenta como si" on review_comments;
drop policy if exists "apaga comentário" on review_comments;
create policy "membros veem comentários" on review_comments for select to authenticated using (is_member());
create policy "comenta como si" on review_comments for insert to authenticated with check (user_id = auth.uid() and is_member());
create policy "apaga comentário" on review_comments for delete to authenticated using (user_id = auth.uid() or owner_id = auth.uid());

-- ---------- Leitura da casa (clube do livro) ----------
create table if not exists house_reads (
  id uuid primary key default gen_random_uuid(),
  book jsonb not null,
  note text check (length(note) <= 500),
  ends_on date,
  created_by uuid default auth.uid() references profiles on delete set null,
  created_at timestamptz default now(),
  closed boolean not null default false
);
alter table house_reads enable row level security;
drop policy if exists "membros veem leituras" on house_reads;
drop policy if exists "membro propõe" on house_reads;
drop policy if exists "quem propôs ou o dono altera" on house_reads;
drop policy if exists "quem propôs ou o dono apaga" on house_reads;
create policy "membros veem leituras" on house_reads for select to authenticated using (is_member());
create policy "membro propõe" on house_reads for insert to authenticated with check (created_by = auth.uid() and is_member());
create policy "quem propôs ou o dono altera" on house_reads for update to authenticated using (created_by = auth.uid() or is_admin());
create policy "quem propôs ou o dono apaga" on house_reads for delete to authenticated using (created_by = auth.uid() or is_admin());

-- ---------- Capas enviadas do celular: guardadas no Storage ----------
insert into storage.buckets (id, name, public) values ('covers', 'covers', true) on conflict (id) do nothing;
drop policy if exists "capas: dono envia" on storage.objects;
drop policy if exists "capas: dono vê" on storage.objects;
drop policy if exists "capas: dono troca" on storage.objects;
drop policy if exists "capas: dono apaga" on storage.objects;
create policy "capas: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "capas: dono vê" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "capas: dono troca" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "capas: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
