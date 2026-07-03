ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS notes_deleted_at_idx ON public.notes (deleted_at);

CREATE OR REPLACE FUNCTION public.purge_old_deleted_notes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.notes
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - INTERVAL '30 days';
$function$;