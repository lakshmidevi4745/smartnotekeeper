
CREATE TABLE public.note_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX note_versions_note_id_created_at_idx
  ON public.note_versions (note_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_versions TO authenticated;
GRANT ALL ON public.note_versions TO service_role;

ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own note versions" ON public.note_versions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
