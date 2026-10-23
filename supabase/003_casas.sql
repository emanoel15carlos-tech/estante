-- Estante · parte 3: conta livre, casas no perfil.
-- Criar conta não pede mais código. Cada leitor pode criar a própria casa e convidar
-- amigos, ou entrar na casa de alguém com o código. Só quem divide uma casa se enxerga.
-- Cole tudo no SQL Editor do Supabase e clique em Run. Pode rodar de novo sem problema.

-- ---------- Casas e moradores ----------
create table if not exists houses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  owner_id uuid not null references profiles on delete cascade,
  invite_code text not null unique,
  created_at timestamptz default now()
);
create table if not exists house_members (
  house_id uuid not null references houses on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (house_id, user_id)
);
alter table houses enable row level security;
alter table house_members enable row level security;

create or replace function in_house(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from house_members where house_id = h and user_id = auth.uid());
$$;

-- Duas pessoas se enxergam quando moram em pelo menos uma casa em comum.
create or replace function shares_house(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists (
    select 1 from house_members a join house_members b on a.house_id = b.house_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function new_invite_code() returns text
language sql volatile as $$
  select 'casa-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
$$;

-- ---------- A casa única da parte 2 vira a primeira casa, com o mesmo código ----------
do $$
declare
  owner uuid;
  code text;
  hid uuid;
begin
  if to_regclass('public.house') is not null and not exists (select 1 from houses) then
    select id into owner from profiles order by is_admin desc, created_at limit 1;
    select invite_code into code from house where id = 1;
    if owner is not null then
      insert into houses (name, owner_id, invite_code)
      values ('Casa de ' || split_part((select display_name from profiles where id = owner), ' ', 1), owner, coalesce(code, new_invite_code()))
      returning id into hid;
      insert into house_members (house_id, user_id, role)
      select hid, p.id, case when p.id = owner then 'owner' else 'member' end from profiles p
      on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------- Funções que o site chama ----------
drop function if exists join_house(text, text, text);

create or replace function create_house(hname text) returns houses
language plpgsql security definer set search_path = public as $$
declare h houses;
begin
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'no_profile'; end if;
  insert into houses (name, owner_id, invite_code) values (trim(hname), auth.uid(), new_invite_code()) returning * into h;
  insert into house_members (house_id, user_id, role) values (h.id, auth.uid(), 'owner');
  return h;
end $$;

create or replace function enter_house(code text) returns houses
language plpgsql security definer set search_path = public as $$
declare h houses;
begin
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'no_profile'; end if;
  select * into h from houses where lower(invite_code) = lower(trim(coalesce(code, '')));
  if not found then raise exception 'invite_invalid'; end if;
  insert into house_members (house_id, user_id, role) values (h.id, auth.uid(), 'member') on conflict do nothing;
  return h;
end $$;

create or replace function leave_house(h uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from houses where id = h and owner_id = auth.uid()) then raise exception 'owner_cannot_leave'; end if;
  delete from house_members where house_id = h and user_id = auth.uid();
end $$;

create or replace function renew_invite(h uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := new_invite_code();
begin
  update houses set invite_code = c where id = h and owner_id = auth.uid();
  if not found then raise exception 'not_owner'; end if;
  return c;
end $$;

create or replace function rename_house(h uuid, hname text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update houses set name = trim(hname) where id = h and owner_id = auth.uid();
  if not found then raise exception 'not_owner'; end if;
end $$;

create or replace function remove_member(h uuid, member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from houses where id = h and owner_id = auth.uid()) then raise exception 'not_owner'; end if;
  if member = auth.uid() then raise exception 'owner_cannot_leave'; end if;
  delete from house_members where house_id = h and user_id = member;
end $$;

create or replace function delete_house(h uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from houses where id = h and owner_id = auth.uid();
  if not found then raise exception 'not_owner'; end if;
end $$;

-- ---------- Quem enxerga o quê ----------
drop policy if exists "moradores veem a casa" on houses;
create policy "moradores veem a casa" on houses for select to authenticated using (in_house(id));
drop policy if exists "moradores veem moradores" on house_members;
create policy "moradores veem moradores" on house_members for select to authenticated using (in_house(house_id));

-- Perfil: qualquer conta abre a própria ficha; vê só quem divide casa.
drop policy if exists "membros veem perfis" on profiles;
drop policy if exists "vê quem divide casa" on profiles;
drop policy if exists "abre a própria ficha" on profiles;
create policy "vê quem divide casa" on profiles for select to authenticated using (shares_house(id));
create policy "abre a própria ficha" on profiles for insert to authenticated with check (id = auth.uid());
grant insert (id, username, display_name) on profiles to authenticated;

drop policy if exists "membros veem estantes" on shelves;
drop policy if exists "vê estantes de quem divide casa" on shelves;
create policy "vê estantes de quem divide casa" on shelves for select to authenticated using (shares_house(user_id));

drop policy if exists "membros veem curtidas" on review_likes;
drop policy if exists "curte como si" on review_likes;
create policy "membros veem curtidas" on review_likes for select to authenticated using (shares_house(owner_id));
create policy "curte como si" on review_likes for insert to authenticated with check (user_id = auth.uid() and shares_house(owner_id));

drop policy if exists "membros veem comentários" on review_comments;
drop policy if exists "comenta como si" on review_comments;
create policy "membros veem comentários" on review_comments for select to authenticated using (shares_house(owner_id));
create policy "comenta como si" on review_comments for insert to authenticated with check (user_id = auth.uid() and shares_house(owner_id));

-- Leitura da casa: agora pertence a uma casa.
alter table house_reads add column if not exists house_id uuid references houses on delete cascade;
update house_reads set house_id = (select id from houses order by created_at limit 1) where house_id is null;
drop policy if exists "membros veem leituras" on house_reads;
drop policy if exists "membro propõe" on house_reads;
drop policy if exists "quem propôs ou o dono altera" on house_reads;
drop policy if exists "quem propôs ou o dono apaga" on house_reads;
create policy "membros veem leituras" on house_reads for select to authenticated using (in_house(house_id));
create policy "membro propõe" on house_reads for insert to authenticated with check (created_by = auth.uid() and in_house(house_id));
create policy "quem propôs ou o dono altera" on house_reads for update to authenticated
  using (created_by = auth.uid() or exists (select 1 from houses where id = house_id and owner_id = auth.uid()));
create policy "quem propôs ou o dono apaga" on house_reads for delete to authenticated
  using (created_by = auth.uid() or exists (select 1 from houses where id = house_id and owner_id = auth.uid()));
