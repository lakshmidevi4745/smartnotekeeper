
ALTER TABLE public.notebooks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS notebooks_deleted_at_idx ON public.notebooks (deleted_at);

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_old_deleted_notebooks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.notebooks
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - INTERVAL '30 days';
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-old-deleted-notebooks');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-old-deleted-notebooks',
  '0 3 * * *',
  $$SELECT public.purge_old_deleted_notebooks();$$
);
