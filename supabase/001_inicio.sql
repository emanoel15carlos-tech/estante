-- Estante · parte 1: perfis e estantes (já aplicado).
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null,
  created_at timestamptz default now()
);
create table shelves (
  user_id uuid primary key references profiles on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
create table shelves_private (
  user_id uuid primary key references profiles on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
alter table shelves enable row level security;
alter table shelves_private enable row level security;
create policy "perfis visíveis a logados" on profiles for select to authenticated using (true);
create policy "edita o próprio perfil" on profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "estantes visíveis a logados" on shelves for select to authenticated using (true);
create policy "edita a própria estante" on shelves for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "privado só do dono" on shelves_private for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
