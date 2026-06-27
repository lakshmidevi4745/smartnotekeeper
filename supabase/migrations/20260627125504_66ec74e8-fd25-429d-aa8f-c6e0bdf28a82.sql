
CREATE TABLE public.note_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_attachments TO authenticated;
GRANT ALL ON public.note_attachments TO service_role;

ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own attachments" ON public.note_attachments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX note_attachments_note_id_idx ON public.note_attachments(note_id);

-- Storage policies: users can manage objects in note-attachments under their own uid folder
CREATE POLICY "note-attachments read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'note-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "note-attachments insert own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'note-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "note-attachments delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'note-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
