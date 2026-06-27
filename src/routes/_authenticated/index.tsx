import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { z } from "zod";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.keep(["table", "thead", "tbody", "tr", "th", "td"]);

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

import { supabase } from "@/integrations/supabase/client";
import {
  listNotebooks,
  listAllNotes,
  createNotebook,
  deleteNotebook,
  renameNotebook,
  createNote,
  updateNote,
  deleteNote,
  getNote,
  commitNote,
  rollbackNote,
} from "@/lib/notes.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  NotebookPen,
  Plus,
  Trash2,
  Search,
  Undo2,
  Redo2,
  GitCommit,
  Undo,
  LogOut,
  FilePlus,
  Pencil,
  Menu,
  X,
  Bold,
  Italic,
  Table as TableIcon,
  Type,
  Palette,
  Highlighter,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const searchSchema = z.object({
  nb: z.string().uuid().optional(),
  n: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "DE Notes" }] }),
  component: AppPage,
});

type Notebook = { id: string; name: string; created_at: string };
type NoteRef = { id: string; notebook_id: string; title: string; updated_at: string };

function AppPage() {
  const navigate = Route.useNavigate();
  const { nb: nbParam, n: noteParam } = Route.useSearch();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const notebooksQ = useQuery({ queryKey: ["notebooks"], queryFn: () => listNotebooks() });
  const notesQ = useQuery({ queryKey: ["notes"], queryFn: () => listAllNotes() });

  const notebooks = (notebooksQ.data ?? []) as Notebook[];
  const allNotes = (notesQ.data ?? []) as NoteRef[];

  const activeNotebookId = nbParam ?? notebooks[0]?.id;
  const notebookNotes = useMemo(
    () => allNotes.filter((n) => n.notebook_id === activeNotebookId),
    [allNotes, activeNotebookId],
  );

  const filteredNotes = useMemo(() => {
    if (!search.trim()) return notebookNotes;
    const q = search.toLowerCase();
    return notebookNotes.filter((n) => n.title.toLowerCase().includes(q));
  }, [notebookNotes, search]);

  const activeNoteId = noteParam ?? filteredNotes[0]?.id;

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (notebooksQ.isLoading) return;
    if (notebooks.length === 0) {
      seededRef.current = true;
      (async () => {
        for (const name of ["Python", "SQL", "PySpark"]) {
          await createNotebook({ data: { name } });
        }
        qc.invalidateQueries({ queryKey: ["notebooks"] });
      })();
    }
  }, [notebooks.length, notebooksQ.isLoading, qc]);

  const selectNotebook = (id: string) => {
    navigate({ to: "/", search: { nb: id } });
    setSidebarOpen(false);
  };
  const selectNote = (note: NoteRef) => {
    navigate({ to: "/", search: { nb: note.notebook_id, n: note.id } });
    setSidebarOpen(false);
  };

  const newNotebookM = useMutation({
    mutationFn: (name: string) => createNotebook({ data: { name } }),
    onSuccess: (nb) => {
      qc.invalidateQueries({ queryKey: ["notebooks"] });
      if (nb) navigate({ to: "/", search: { nb: nb.id } });
    },
  });

  const renameNotebookM = useMutation({
    mutationFn: (v: { id: string; name: string }) => renameNotebook({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notebooks"] }),
  });

  const deleteNotebookM = useMutation({
    mutationFn: (id: string) => deleteNotebook({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notebooks"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/", search: {} });
    },
  });

  const newNoteM = useMutation({
    mutationFn: (v: { notebook_id: string; title?: string; content?: string }) =>
      createNote({ data: v }),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      if (note) navigate({ to: "/", search: { nb: note.notebook_id, n: note.id } });
    },
  });

  const deleteNoteM = useMutation({
    mutationFn: (id: string) => deleteNote({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/", search: { nb: activeNotebookId } });
    },
  });

  const handleNewNotebook = () => {
    const name = window.prompt("Notebook name");
    if (name?.trim()) newNotebookM.mutate(name.trim());
  };
  const handleRenameNotebook = (nb: Notebook) => {
    const name = window.prompt("Rename notebook", nb.name);
    if (name?.trim() && name !== nb.name) renameNotebookM.mutate({ id: nb.id, name: name.trim() });
  };

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const sidebar = (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <NotebookPen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">DE Notes</div>
          <div className="text-[10px] text-muted-foreground">Python · SQL · PySpark</div>
        </div>
        <Button size="icon" variant="ghost" onClick={handleSignOut} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="md:hidden"
          onClick={() => setSidebarOpen(false)}
          title="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Notebooks</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleNewNotebook}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-0.5">
          {notebooks.map((nb) => {
            const active = nb.id === activeNotebookId;
            return (
              <div
                key={nb.id}
                className={`group flex items-center rounded-md ${active ? "bg-primary/10" : "hover:bg-accent"}`}
              >
                <button
                  onClick={() => selectNotebook(nb.id)}
                  className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm ${active ? "font-medium text-primary" : ""}`}
                >
                  {nb.name}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 md:opacity-0 md:group-hover:opacity-100"
                  onClick={() => handleRenameNotebook(nb)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <DeleteButton
                  label={`Delete notebook "${nb.name}" and all its notes?`}
                  onConfirm={() => deleteNotebookM.mutate(nb.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b p-3">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Notes</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={!activeNotebookId}
            onClick={() =>
              activeNotebookId &&
              newNoteM.mutate({ notebook_id: activeNotebookId, title: "Untitled" })
            }
          >
            <FilePlus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 px-2 pb-3">
            {filteredNotes.map((note) => {
              const active = note.id === activeNoteId;
              return (
                <div
                  key={note.id}
                  className={`group flex items-center rounded-md ${active ? "bg-primary/10" : "hover:bg-accent"}`}
                >
                  <button
                    onClick={() => selectNote(note)}
                    className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm ${active ? "font-medium text-primary" : ""}`}
                  >
                    {note.title || "Untitled"}
                  </button>
                  <DeleteButton
                    label={`Delete note "${note.title}"?`}
                    onConfirm={() => deleteNoteM.mutate(note.id)}
                  />
                </div>
              );
            })}
            {filteredNotes.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {activeNotebookId ? "No notes yet. Click +" : "Create a notebook to begin"}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-muted/30 md:flex">
        {sidebar}
      </aside>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col border-r bg-background shadow-xl">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Editor */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-2 py-2 md:hidden">
          <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="truncate text-sm font-medium">
            {notebooks.find((nb) => nb.id === activeNotebookId)?.name ?? "DE Notes"}
          </span>
        </div>

        {activeNoteId ? (
          <NoteEditor key={activeNoteId} noteId={activeNoteId} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <NotebookPen className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="mb-4 text-sm text-muted-foreground">
                {activeNotebookId ? "No note selected" : "Create a notebook to begin"}
              </p>
              {activeNotebookId && (
                <Button
                  onClick={() =>
                    newNoteM.mutate({ notebook_id: activeNotebookId, title: "Untitled" })
                  }
                  disabled={newNoteM.isPending}
                >
                  <FilePlus className="mr-2 h-4 w-4" />
                  New note
                </Button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 md:opacity-0 md:group-hover:opacity-100"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3 w-3 text-destructive" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete?</AlertDialogTitle>
            <AlertDialogDescription>{label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* -------------------- Note Editor with undo/redo/commit/rollback -------------------- */

function NoteEditor({ noteId }: { noteId: string }) {
  const qc = useQueryClient();
  const noteQ = useQuery({ queryKey: ["note", noteId], queryFn: () => getNote({ data: { id: noteId } }) });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [tab, setTab] = useState<"edit" | "preview">("preview");

  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushedRef = useRef<string>("");
  const hydratedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!noteQ.data) return;
    hydratedRef.current = true;
    setTitle(noteQ.data.title);
    setContent(noteQ.data.content);
    undoStack.current = [noteQ.data.content];
    redoStack.current = [];
    lastPushedRef.current = noteQ.data.content;
    setSaveState("saved");
  }, [noteQ.data]);

  const pushHistory = useCallback((value: string) => {
    const last = lastPushedRef.current;
    if (value === last) return;
    undoStack.current.push(value);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    lastPushedRef.current = value;
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(
    (next: { title?: string; content?: string }) => {
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await updateNote({ data: { id: noteId, ...next } });
          setSaveState("saved");
          qc.invalidateQueries({ queryKey: ["notes"] });
        } catch (e) {
          setSaveState("dirty");
          toast.error(e instanceof Error ? e.message : "Save failed");
        }
      }, 700);
    },
    [noteId, qc],
  );

  const onContentChange = (v: string) => {
    setContent(v);
    setSaveState("dirty");
    const last = lastPushedRef.current;
    if (Math.abs(v.length - last.length) > 30 || /\s$/.test(v) !== /\s$/.test(last)) {
      pushHistory(v);
    }
    scheduleSave({ content: v });
  };

  const onTitleChange = (v: string) => {
    setTitle(v);
    setSaveState("dirty");
    scheduleSave({ title: v });
  };

  const applyEdit = useCallback(
    (transform: (sel: string) => { text: string; selectAfter?: [number, number] }) => {
      const ta = textareaRef.current;
      const start = ta?.selectionStart ?? content.length;
      const end = ta?.selectionEnd ?? content.length;
      const selected = content.slice(start, end);
      const { text, selectAfter } = transform(selected);
      const next = content.slice(0, start) + text + content.slice(end);
      setContent(next);
      setSaveState("dirty");
      pushHistory(next);
      scheduleSave({ content: next });
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const [s, e] = selectAfter ?? [start + text.length, start + text.length];
        el.setSelectionRange(s, e);
      });
    },
    [content, pushHistory, scheduleSave],
  );

  const applyToPreviewSelection = useCallback(
    (wrap: (sel: string) => string): boolean => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return false;
      const selText = sel.toString();
      if (!selText.trim()) return false;
      const range = sel.getRangeAt(0);
      if (!previewRef.current?.contains(range.commonAncestorContainer)) return false;
      const idx = content.indexOf(selText);
      if (idx === -1) return false;
      if (content.indexOf(selText, idx + 1) !== -1) {
        toast.error("Selection appears multiple times — refine it or use Edit mode");
        return false;
      }
      const wrapped = wrap(selText);
      const next = content.slice(0, idx) + wrapped + content.slice(idx + selText.length);
      setContent(next);
      setSaveState("dirty");
      pushHistory(next);
      scheduleSave({ content: next });
      sel.removeAllRanges();
      return true;
    },
    [content, pushHistory, scheduleSave],
  );

  const applyFormat = (htmlWrap: (s: string) => string, placeholder = "text") => {
    if (tab === "preview") {
      if (!applyToPreviewSelection(htmlWrap)) {
        toast.message("Select text in the preview first");
      }
      return;
    }
    applyEdit((s) => ({ text: htmlWrap(s || placeholder) }));
  };

  const setFontSize = (size: string) =>
    applyFormat((s) => `<span style="font-size:${size}">${s}</span>`);
  const setTextColor = (color: string) =>
    applyFormat((s) => `<span style="color:${color}">${s}</span>`);
  const setBgColor = (color: string) =>
    applyFormat(
      (s) => `<span style="background-color:${color};padding:0 2px;border-radius:3px">${s}</span>`,
    );
  const insertBold = () => applyFormat((s) => `**${s}**`, "bold");
  const insertItalic = () => applyFormat((s) => `*${s}*`, "italic");
  const insertTable = (rows: number, cols: number) => {
    const header = "| " + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(" | ") + " |";
    const sep = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
    const body = Array.from({ length: cols }, () => "").length
      ? Array.from({ length: rows }, () =>
          "| " + Array.from({ length: cols }, () => "   ").join(" | ") + " |",
        ).join("\n")
      : "";
    const table = `\n\n${header}\n${sep}\n${body}\n\n`;
    const next = content + table;
    setContent(next);
    setSaveState("dirty");
    pushHistory(next);
    scheduleSave({ content: next });
  };

  const doUndo = () => {
    if (undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    lastPushedRef.current = prev;
    setContent(prev);
    scheduleSave({ content: prev });
  };

  const doRedo = () => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(next);
    lastPushedRef.current = next;
    setContent(next);
    scheduleSave({ content: next });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const commitM = useMutation({
    mutationFn: () => commitNote({ data: { id: noteId, content } }),
    onSuccess: () => {
      toast.success("Committed");
      qc.invalidateQueries({ queryKey: ["note", noteId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Commit failed"),
  });

  const [rollbackOpen, setRollbackOpen] = useState(false);
  const rollbackM = useMutation({
    mutationFn: () => rollbackNote({ data: { id: noteId } }),
    onSuccess: (res) => {
      const c = res?.content ?? "";
      setContent(c);
      pushHistory(c);
      toast.success("Rolled back to last commit");
      qc.invalidateQueries({ queryKey: ["note", noteId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Rollback failed"),
  });

  const committedAt = noteQ.data?.committed_at ? new Date(noteQ.data.committed_at) : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled"
          className="h-9 min-w-0 flex-1 border-0 px-0 text-base font-semibold shadow-none focus-visible:ring-0"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "•"}
        </span>
      </div>
      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
          <ToolbarBtn label="Undo (⌘Z)" onClick={doUndo} disabled={undoStack.current.length <= 1}>
            <Undo2 className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn label="Redo (⇧⌘Z)" onClick={doRedo} disabled={redoStack.current.length === 0}>
            <Redo2 className="h-4 w-4" />
          </ToolbarBtn>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarBtn label="Commit current version" onClick={() => commitM.mutate()}>
            <GitCommit className="h-4 w-4" />
            <span className="ml-1 hidden text-xs sm:inline">Commit</span>
          </ToolbarBtn>
          <ToolbarBtn
            label="Rollback to last commit"
            onClick={() => setRollbackOpen(true)}
            disabled={!committedAt}
          >
            <Undo className="h-4 w-4" />
            <span className="ml-1 hidden text-xs sm:inline">Rollback</span>
          </ToolbarBtn>
          {committedAt && (
            <span className="ml-2 hidden text-[10px] text-muted-foreground lg:inline">
              last commit {committedAt.toLocaleString()}
            </span>
          )}

          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarBtn label="Bold" onClick={insertBold}>
            <Bold className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn label="Italic" onClick={insertItalic}>
            <Italic className="h-4 w-4" />
          </ToolbarBtn>
          <Select onValueChange={setFontSize}>
            <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs">
              <Type className="h-4 w-4" />
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="12px">Small (12)</SelectItem>
              <SelectItem value="14px">Normal (14)</SelectItem>
              <SelectItem value="18px">Large (18)</SelectItem>
              <SelectItem value="24px">X-Large (24)</SelectItem>
              <SelectItem value="32px">Huge (32)</SelectItem>
            </SelectContent>
          </Select>
          <ColorPicker
            label="Text color"
            icon={<Palette className="h-4 w-4" />}
            defaultColor="#111827"
            onPick={setTextColor}
          />
          <ColorPicker
            label="Highlight"
            icon={<Highlighter className="h-4 w-4" />}
            defaultColor="#fde047"
            onPick={setBgColor}
          />
          <TableInsert onInsert={insertTable} />


          <div className="ml-auto">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "edit" | "preview")}>
              <TabsList className="h-7">
                <TabsTrigger value="edit" className="text-xs">
                  Edit
                </TabsTrigger>
                <TabsTrigger value="preview" className="text-xs">
                  Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </TooltipProvider>

      <div className="flex-1 overflow-hidden">
        {tab === "edit" ? (
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            onBlur={() => pushHistory(content)}
            onPaste={(e) => {
              const html = e.clipboardData.getData("text/html");
              if (!html) return;
              e.preventDefault();
              const md = htmlToMarkdown(html);
              const ta = e.currentTarget;
              const start = ta.selectionStart ?? content.length;
              const end = ta.selectionEnd ?? content.length;
              const next = content.slice(0, start) + md + content.slice(end);
              onContentChange(next);
              pushHistory(next);
            }}
            placeholder="# Start writing markdown…&#10;&#10;Paste from Word / ChatGPT — formatting is preserved. Use ```python or ```sql code blocks."
            className="h-full w-full resize-none rounded-none border-0 bg-background font-mono text-sm leading-relaxed focus-visible:ring-0"
          />
        ) : (
          <ScrollArea className="h-full">
            <div
              ref={previewRef}
              className="mx-auto max-w-3xl p-4 sm:p-6"
              tabIndex={0}
              onPaste={(e) => {
                const html = e.clipboardData.getData("text/html");
                const text = e.clipboardData.getData("text/plain");
                const md = html ? htmlToMarkdown(html) : text;
                if (!md) return;
                e.preventDefault();
                const next = content + (content && !content.endsWith("\n\n") ? "\n\n" : "") + md;
                onContentChange(next);
                pushHistory(next);
                toast.success("Pasted formatted content");
              }}
            >
              <MarkdownView source={content} />
            </div>
          </ScrollArea>
        )}
      </div>

      <AlertDialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback to last commit?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards changes made since {committedAt?.toLocaleString()}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                rollbackM.mutate();
                setRollbackOpen(false);
              }}
            >
              Rollback
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/* -------------------- Markdown rendering -------------------- */

function MarkdownView({ source }: { source: string }) {
  return (
    <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-3xl prose-h1:mt-6 prose-h1:mb-4 prose-h2:text-2xl prose-h2:mt-6 prose-h2:mb-3 prose-h3:text-xl prose-h3:mt-5 prose-h3:mb-2 prose-p:my-3 prose-p:leading-7 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-table:my-4 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-4 prose-blockquote:border-primary/40 prose-blockquote:pl-4 prose-blockquote:italic prose-hr:my-6 prose-strong:font-semibold prose-a:text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const text = String(children).replace(/\n$/, "");
            const isBlock = text.includes("\n") || !!match;
            if (!isBlock) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <SyntaxHighlighter
                language={match?.[1] ?? "text"}
                style={oneDark}
                customStyle={{ borderRadius: 8, fontSize: 13 }}
                PreTag="div"
              >
                {text}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {source || "*Empty note*"}
      </ReactMarkdown>
    </div>
  );
}

/* -------------------- Formatting helpers -------------------- */

function ColorPicker({
  label,
  icon,
  onPick,
  defaultColor = "#000000",
}: {
  label: string;
  icon: React.ReactNode;
  onPick: (color: string) => void;
  defaultColor?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(defaultColor);
  return (
    <div className="relative inline-flex">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2"
        title={label}
        onClick={() => inputRef.current?.click()}
      >
        {icon}
        <span
          className="h-3 w-3 rounded-sm border border-border"
          style={{ background: color }}
          aria-hidden
        />
      </Button>
      <input
        ref={inputRef}
        type="color"
        value={color}
        onChange={(e) => {
          setColor(e.target.value);
          onPick(e.target.value);
        }}
        className="pointer-events-none absolute inset-0 h-0 w-0 opacity-0"
        tabIndex={-1}
        aria-label={label}
      />
    </div>
  );
}

function TableInsert({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Insert table">
          <TableIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3">
        <div className="mb-2 text-xs font-medium">Insert table</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            Rows
            <Input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="h-8"
            />
          </label>
          <label className="flex flex-col gap-1">
            Cols
            <Input
              type="number"
              min={1}
              max={10}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className="h-8"
            />
          </label>
        </div>
        <Button
          size="sm"
          className="mt-3 h-7 w-full"
          onClick={() => {
            onInsert(rows, cols);
            setOpen(false);
          }}
        >
          Insert
        </Button>
      </PopoverContent>
    </Popover>
  );
}
