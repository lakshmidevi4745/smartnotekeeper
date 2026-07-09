ALTER TABLE public.notebooks REPLICA IDENTITY FULL;
ALTER TABLE public.notes REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notebooks;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;