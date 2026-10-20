-- Wak'Forge : base de données pour les comptes.
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.

-- Une ligne par utilisateur : sa liste perso, ses durées perso et ses timers (JSON).
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Sécurité : chacun ne voit et ne modifie que SA ligne.
alter table public.user_state enable row level security;

drop policy if exists "user_state lecture"     on public.user_state;
drop policy if exists "user_state ajout"       on public.user_state;
drop policy if exists "user_state modif"       on public.user_state;
drop policy if exists "user_state suppression" on public.user_state;

create policy "user_state lecture" on public.user_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_state ajout" on public.user_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_state modif" on public.user_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_state suppression" on public.user_state
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Taille maximale d'un état (évite les abus) : 512 Ko.
alter table public.user_state drop constraint if exists user_state_taille;
alter table public.user_state add constraint user_state_taille check (pg_column_size(state) < 524288);

-- Synchronisation en direct entre appareils.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_state'
  ) then
    alter publication supabase_realtime add table public.user_state;
  end if;
end $$;
