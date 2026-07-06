-- ============================================================
-- Realtime DELETE propagation
-- ============================================================
-- The threads Realtime subscription filters on project_id. Postgres evaluates
-- that filter against the DELETE event's OLD row, but with the default replica
-- identity (primary key only) OLD carries just the id — so filtered DELETE
-- events are dropped and other clients never learn a thread was deleted.
--
-- REPLICA IDENTITY FULL makes OLD carry every column on DELETE, so the
-- project_id filter matches and subscribers receive the event. Applied to
-- comments too for a complete OLD payload on comment deletes.

alter table public.threads replica identity full;
alter table public.comments replica identity full;
