import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  listAttachments,
  recordAttachment,
  signAttachment,
  deleteAttachment,
} from "@/lib/notes.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  Sparkles,
  Send,
  ChevronRight,
  ChevronLeft,
  LogOut,
  FilePlus,
  Pencil,
  Paperclip,
  Download,
  FileText,
  ImageIcon,
} from "lucide-react";

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
  const [aiOpen, setAiOpen] = useState(true);
  const [search, setSearch] = useState("");

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

  // create defaults if user has nothing
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

  const selectNotebook = (id: string) => navigate({ to: "/", search: { nb: id } });
  const selectNote = (note: NoteRef) =>
    navigate({ to: "/", search: { nb: note.notebook_id, n: note.id } });

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

  const insertIntoActiveNote = useCallback(
    (markdown: string) => {
      const event = new CustomEvent("notes:insert", { detail: markdown });
      window.dispatchEvent(event);
    },
    [],
  );

  const createNoteFromText = (text: string) => {
    if (!activeNotebookId) return;
    const firstLine = text.split("\n").find((l) => l.trim());
    const title = (firstLine ?? "AI note").replace(/^#+\s*/, "").slice(0, 80) || "AI note";
    newNoteM.mutate({ notebook_id: activeNotebookId, title, content: text });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <NotebookPen className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold leading-tight">DE Notes</div>
            <div className="text-[10px] text-muted-foreground">Python · SQL · PySpark</div>
          </div>
          <Button size="icon" variant="ghost" onClick={handleSignOut} title="Sign out">
            <LogOut className="h-4 w-4" />
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
                    className={`flex-1 truncate px-2 py-1.5 text-left text-sm ${active ? "font-medium text-primary" : ""}`}
                  >
                    {nb.name}
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
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

        <div className="flex flex-1 flex-col overflow-hidden">
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
                activeNotebookId && newNoteM.mutate({ notebook_id: activeNotebookId, title: "Untitled" })
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
                      className={`flex-1 truncate px-2 py-1.5 text-left text-sm ${active ? "font-medium text-primary" : ""}`}
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
      </aside>

      {/* Editor */}
      <main className="flex min-w-0 flex-1 flex-col">
        {activeNoteId ? (
          <NoteEditor key={activeNoteId} noteId={activeNoteId} onInsert={insertIntoActiveNote} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <NotebookPen className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {activeNotebookId ? "Select or create a note" : "Create a notebook to begin"}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* AI Panel */}
      <aside
        className={`flex shrink-0 flex-col border-l bg-muted/20 transition-all ${aiOpen ? "w-[420px]" : "w-10"}`}
      >
        <button
          className="flex h-10 items-center justify-center border-b text-muted-foreground hover:bg-accent"
          onClick={() => setAiOpen((v) => !v)}
          title={aiOpen ? "Hide AI panel" : "Show AI panel"}
        >
          {aiOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        {aiOpen && (
          <AiPanel
            canInsert={!!activeNoteId}
            onInsert={insertIntoActiveNote}
            onCreateNote={createNoteFromText}
          />
        )}
      </aside>
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
        className="h-6 w-6 opacity-0 group-hover:opacity-100"
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

function NoteEditor({ noteId, onInsert }: { noteId: string; onInsert: (md: string) => void }) {
  const qc = useQueryClient();
  const noteQ = useQuery({ queryKey: ["note", noteId], queryFn: () => getNote({ data: { id: noteId } }) });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [tab, setTab] = useState<"edit" | "preview">("preview");

  // history stack
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushedRef = useRef<string>("");
  const hydratedRef = useRef(false);

  // hydrate when note loads
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

  // push to history (debounced via change-grouping by length delta)
  const pushHistory = useCallback((value: string) => {
    const last = lastPushedRef.current;
    if (value === last) return;
    undoStack.current.push(value);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    lastPushedRef.current = value;
  }, []);

  // autosave debounced
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
    // group small edits, snapshot on whitespace boundaries
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

  // keyboard shortcuts
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

  // listen for AI insert events
  useEffect(() => {
    const handler = (e: Event) => {
      const md = (e as CustomEvent<string>).detail;
      const next = content + (content.endsWith("\n\n") || content === "" ? "" : "\n\n") + md;
      onContentChange(next);
      pushHistory(next);
      toast.success("Inserted into note");
    };
    window.addEventListener("notes:insert", handler);
    return () => window.removeEventListener("notes:insert", handler);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  const committedAt = noteQ.data?.committed_at ? new Date(noteQ.data.committed_at) : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled"
          className="h-9 border-0 px-0 text-base font-semibold shadow-none focus-visible:ring-0"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "•"}
        </span>
      </div>
      <TooltipProvider>
        <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
          <ToolbarBtn label="Undo (⌘Z)" onClick={doUndo} disabled={undoStack.current.length <= 1}>
            <Undo2 className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn label="Redo (⇧⌘Z)" onClick={doRedo} disabled={redoStack.current.length === 0}>
            <Redo2 className="h-4 w-4" />
          </ToolbarBtn>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarBtn label="Commit current version" onClick={() => commitM.mutate()}>
            <GitCommit className="h-4 w-4" />
            <span className="ml-1 text-xs">Commit</span>
          </ToolbarBtn>
          <ToolbarBtn
            label="Rollback to last commit"
            onClick={() => setRollbackOpen(true)}
            disabled={!committedAt}
          >
            <Undo className="h-4 w-4" />
            <span className="ml-1 text-xs">Rollback</span>
          </ToolbarBtn>
          {committedAt && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              last commit {committedAt.toLocaleString()}
            </span>
          )}

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

      <NoteAttachments noteId={noteId} onInsertMarkdown={(md) => {
        const next = content + (content && !content.endsWith("\n\n") ? "\n\n" : "") + md;
        onContentChange(next);
        pushHistory(next);
      }} />

      <div className="flex-1 overflow-hidden">

        {tab === "edit" ? (
          <Textarea
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
              className="mx-auto max-w-3xl p-6"
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

/* -------------------- AI Panel -------------------- */

function AiPanel({
  canInsert,
  onInsert,
  onCreateNote,
}: {
  canInsert: boolean;
  onInsert: (md: string) => void;
  onCreateNote: (md: string) => void;
}) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error } = useChat({ transport });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === "submitted" || status === "streaming") return;
    sendMessage({ text });
    setInput("");
  };

  const messageText = (m: UIMessage) =>
    m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Ask Gemini</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Lovable AI</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-2 px-1 text-xs text-muted-foreground">
            <p>Try:</p>
            <ul className="space-y-1">
              <li>• "Explain Python decorators with an example"</li>
              <li>• "PySpark groupBy vs window functions"</li>
              <li>• "SQL: difference between CTE and subquery"</li>
            </ul>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((m) => {
            const text = messageText(m);
            const isUser = m.role === "user";
            return (
              <div key={m.id}>
                {isUser ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                      {text}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <MarkdownView source={text} />
                    {text && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          disabled={!canInsert}
                          onClick={() => onInsert(text)}
                        >
                          Insert into note
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onCreateNote(text)}
                        >
                          New note
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {(status === "submitted" || status === "streaming") &&
            messages[messages.length - 1]?.role === "user" && (
              <div className="text-xs text-muted-foreground">Thinking…</div>
            )}
        </div>
      </div>

      <form onSubmit={onSend} className="border-t p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Ask about Python, SQL, PySpark…"
            className="max-h-32 min-h-[40px] resize-none text-sm"
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || status === "submitted" || status === "streaming"}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
