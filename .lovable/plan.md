
## Goal
Let you save the current state of a note as a named version (e.g. "Version 1"), see the list of saved versions, and restore any of them later — so today's working state is preserved even after future edits.

## How it works (user-facing)
- Each note gets a new "Versions" button in the toolbar (next to Commit/Rollback).
- Clicking it opens a dialog with:
  - "Save current as version…" input (default name auto-filled: `Version N`) + Save button.
  - List of saved versions for that note: name, timestamp, Restore, Delete.
- "Save" snapshots the note's current content under that name.
- "Restore" replaces the current note content with that snapshot (the pre-restore content is auto-saved as `Auto-backup before restore <time>` so nothing is ever lost).
- Works across devices via existing realtime sync.

## First version
Right after this ships, open the MYSQL / any notebook you want frozen, click Versions → Save, and it's stored as "Version 1". That snapshot stays untouched no matter what future edits or pastes happen.

## Technical details
1. New table `public.note_versions`:
   - `id uuid pk`, `note_id uuid fk notes`, `user_id uuid`, `name text`, `content text`, `created_at timestamptz`.
   - RLS: user can CRUD only their own rows. GRANT select/insert/delete to `authenticated`, all to `service_role`.
2. Server functions in `src/lib/notes.functions.ts`:
   - `listNoteVersions({ note_id })`
   - `saveNoteVersion({ note_id, name })` — reads current `notes.content`, inserts snapshot.
   - `restoreNoteVersion({ id })` — loads snapshot, auto-creates a backup version of current content, then updates `notes.content`.
   - `deleteNoteVersion({ id })`.
3. UI in `src/routes/_authenticated/index.tsx`:
   - New `VersionsDialog` component; toolbar button opens it.
   - Uses TanStack Query with `note-versions` key; invalidates on save/restore/delete.
   - On restore: cancel pending autosave (reuse existing `cancelPendingSave` + `saveSeqRef` pattern used by Rollback) then set editor content from snapshot.
4. No change to existing Commit/Rollback (that stays as the single-slot quick checkpoint); Versions is the named multi-snapshot history.

## Out of scope
- Diff view between versions.
- Auto-scheduled snapshots.
