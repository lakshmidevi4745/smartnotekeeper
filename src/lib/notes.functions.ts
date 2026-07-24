import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const uuid = z.string().uuid();

export const listNotebooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notebooks")
      .select("id, name, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listDeletedNotebooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notebooks")
      .select("id, name, deleted_at")
      .not("deleted_at", "is", null)
      .gte("deleted_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const restoreNotebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notebooks")
      .update({ deleted_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const purgeNotebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("notebooks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const listAllNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notes")
      .select("id, notebook_id, title, updated_at, notebooks!inner(deleted_at)")
      .is("deleted_at", null)
      .is("notebooks.deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(({ notebooks: _n, ...rest }) => rest);
  });

export const listDeletedNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notes")
      .select("id, notebook_id, title, deleted_at, notebooks!inner(name, deleted_at)")
      .not("deleted_at", "is", null)
      .is("notebooks.deleted_at", null)
      .gte("deleted_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      notebook_id: r.notebook_id,
      title: r.title,
      deleted_at: r.deleted_at,
      notebook_name: (r.notebooks as unknown as { name: string }).name,
    }));
  });

export const restoreNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notes")
      .update({ deleted_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const purgeNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const createNotebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("notebooks")
      .insert({ name: data.name, user_id: context.userId })
      .select("id, name, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameNotebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, name: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("notebooks").update({ name: data.name }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNotebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notebooks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const getNote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("notes")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        notebook_id: uuid,
        title: z.string().max(200).optional(),
        content: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("notes")
      .insert({
        notebook_id: data.notebook_id,
        user_id: context.userId,
        title: data.title ?? "Untitled",
        content: data.content ?? "",
      })
      .select("id, notebook_id, title, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid,
        title: z.string().max(200).optional(),
        content: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: { title?: string; content?: string } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.content !== undefined) patch.content = data.content;
    const { error } = await context.supabase.from("notes").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const commitNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, content: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notes")
      .update({ content: data.content, committed_content: data.content, committed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rollbackNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("notes")
      .select("committed_content")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const { error: upErr } = await context.supabase
      .from("notes")
      .update({ content: row.committed_content })
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);
    return { content: row.committed_content };
  });

export const listNoteVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ note_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("note_versions")
      .select("id, name, created_at")
      .eq("note_id", data.note_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveNoteVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ note_id: uuid, name: z.string().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: note, error: selErr } = await context.supabase
      .from("notes")
      .select("content")
      .eq("id", data.note_id)
      .single();
    if (selErr) throw new Error(selErr.message);
    const { data: row, error } = await context.supabase
      .from("note_versions")
      .insert({
        note_id: data.note_id,
        user_id: context.userId,
        name: data.name,
        content: note.content ?? "",
      })
      .select("id, name, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const restoreNoteVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: version, error: vErr } = await context.supabase
      .from("note_versions")
      .select("id, note_id, content")
      .eq("id", data.id)
      .single();
    if (vErr) throw new Error(vErr.message);
    const { data: currentNote, error: nErr } = await context.supabase
      .from("notes")
      .select("content")
      .eq("id", version.note_id)
      .single();
    if (nErr) throw new Error(nErr.message);
    const backupName = `Auto-backup before restore ${new Date().toLocaleString()}`;
    await context.supabase.from("note_versions").insert({
      note_id: version.note_id,
      user_id: context.userId,
      name: backupName,
      content: currentNote.content ?? "",
    });
    const { error: upErr } = await context.supabase
      .from("notes")
      .update({ content: version.content })
      .eq("id", version.note_id);
    if (upErr) throw new Error(upErr.message);
    return { content: version.content, note_id: version.note_id };
  });

export const deleteNoteVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("note_versions")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ note_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("note_attachments")
      .select("id, file_name, mime_type, size, storage_path, created_at")
      .eq("note_id", data.note_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        note_id: uuid,
        storage_path: z.string(),
        file_name: z.string(),
        mime_type: z.string().optional(),
        size: z.number().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("note_attachments")
      .insert({
        note_id: data.note_id,
        user_id: context.userId,
        storage_path: data.storage_path,
        file_name: data.file_name,
        mime_type: data.mime_type,
        size: data.size,
      })
      .select("id, file_name, mime_type, size, storage_path, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const signAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ storage_path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("note-attachments")
      .createSignedUrl(data.storage_path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

export const deleteAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error: selErr } = await context.supabase
      .from("note_attachments")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (selErr) throw new Error(selErr.message);
    await context.supabase.storage.from("note-attachments").remove([row.storage_path]);
    const { error } = await context.supabase.from("note_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
