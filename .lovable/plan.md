## Smart Notes for Data Engineers

A clean, code-friendly notebook for organizing Python, SQL, PySpark (and other DE) notes you collect from AI conversations — with a built-in AI panel powered by Lovable AI (Gemini) so you can ask and capture without leaving the app.

### Core features

1. **Notebooks + Notes**
   - Left sidebar lists notebooks (e.g. Python, SQL, PySpark, Airflow, dbt). Click a notebook to see its notes.
   - Create / rename / delete notebooks and notes.
   - Global search box across all notes (title + content), with topic filter.

2. **Editor**
   - Markdown editor with live preview, code blocks with syntax highlighting for python/sql/scala (PySpark snippets).
   - Title + tags per note.
   - **Autosave** with a small "Saved ✓ / Saving…" indicator (debounced ~800ms).
   - **Undo / Redo** buttons (plus Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z), backed by an in-memory history stack for the active editing session.
   - **Commit**: saves the current note state as the "committed baseline". Button shows last commit time.
   - **Rollback**: reverts the editor (and saved note) to the last committed baseline. Confirms before discarding uncommitted changes.

3. **AI panel (right side, collapsible)**
   - Chat with Gemini (`google/gemini-3-flash-preview` via Lovable AI Gateway) about any DE topic.
   - Streamed responses, markdown + code rendering.
   - "Insert into note" button on each AI reply — appends the organized answer (with a heading) into the currently open note.
   - "New note from reply" creates a fresh note in the current notebook with that content.
   - Conversation is per-session (not persisted) — keeps things simple; the value lives in the notes you save.

4. **Auth + sync**
   - Lovable Cloud with email/password + Google sign-in.
   - Notebooks and notes are per-user (RLS), accessible from any device.

### Technical details

- **Stack**: TanStack Start + Lovable Cloud + Lovable AI Gateway (already on the project).
- **Routes**:
  - `/auth` — sign in / sign up (public).
  - `/_authenticated/` layout gates the rest.
  - `/_authenticated/` index → redirects to first notebook or empty state.
  - `/_authenticated/n/$notebookId` — notebook view with note list.
  - `/_authenticated/n/$notebookId/$noteId` — editor.
- **DB tables** (public schema, RLS scoped to `auth.uid()`, with required GRANTs):
  - `notebooks(id, user_id, name, created_at, updated_at)`
  - `notes(id, notebook_id, user_id, title, content, committed_content, committed_at, updated_at, created_at)`
  - `committed_content` + `committed_at` power Rollback. Autosave writes to `content`; Commit copies `content` → `committed_content`.
- **Server functions** (`createServerFn` + `requireSupabaseAuth`):
  - list/create/rename/delete notebook
  - list/create/update (autosave)/delete note
  - commit note, rollback note
  - `askAI` — server function calling Lovable AI Gateway (`google/gemini-3-flash-preview`) with `streamText` via a `/api/chat` route for the AI panel.
- **Undo/redo**: handled client-side in the editor with a bounded history stack (e.g. 100 steps); not persisted.
- **Editor**: `@uiw/react-md-editor` (or a textarea + `react-markdown` + `react-syntax-highlighter` fallback) for markdown + code preview.
- **AI panel**: AI Elements (`conversation`, `message`, `prompt-input`, `shimmer`) wired to `useChat` against `/api/chat`.
- **Search**: client-side filter over loaded notes; can move to Postgres `ilike` later if volume grows.

### Out of scope (can add later)
- Version history beyond the single commit baseline.
- Sharing notes / public links.
- Image uploads / attachments.
- Mobile-optimized layout polish beyond responsive defaults.

Approve and I'll enable Lovable Cloud, set up the schema + auth, and build the UI.