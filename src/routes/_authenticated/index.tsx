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

const RICH_TEXT_PASTE_LIMIT = 8_000;
const LARGE_CONTENT_LIMIT = 20_000;
const LARGE_TOC_PARSE_LIMIT = 50_000;

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

function ensureTrailingParagraph(root: HTMLElement) {
  const last = root.lastElementChild;
  const blockTags = ["TABLE", "PRE", "BLOCKQUOTE", "UL", "OL", "HR"];
  if (!last || blockTags.includes(last.tagName)) {
    const p = document.createElement("p");
    p.innerHTML = "<br/>";
    root.appendChild(p);
  }
}

function editableToPlainText(root: HTMLElement): string {
  const parts: string[] = [];
  const blockTags = new Set(["DIV", "P", "LI", "TR", "TABLE", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);

  const pushNewline = () => {
    const last = parts[parts.length - 1];
    if (last !== "\n") parts.push("\n");
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent?.replace(/\u00a0/g, " ") ?? "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      pushNewline();
      return;
    }

    const isBlock = blockTags.has(el.tagName);
    if (isBlock && parts.length > 0) pushNewline();
    el.childNodes.forEach(walk);
    if (isBlock) pushNewline();
  };

  root.childNodes.forEach(walk);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function getEditableSelectionOffsets(root: HTMLElement, fallbackLength: number) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: fallbackLength, end: fallbackLength };
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return { start: fallbackLength, end: fallbackLength };
  }

  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = Math.min(before.toString().length, fallbackLength);
  const end = Math.min(start + range.toString().length, fallbackLength);
  return { start, end };
}

function countLineBreaks(value: string) {
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) count++;
  }
  return count;
}

function estimateHtmlLineBreaks(html: string) {
  let count = 0;
  const re = /<br\b|<\/div>|<\/p>|<\/li>|<\/tr>/gi;
  while (re.exec(html)) count++;
  return count;
}

function clipboardHtmlToPlainText(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return editableToPlainText(root);
}

function readClipboardItemText(data: DataTransfer) {
  const item = Array.from(data.items).find(
    (entry) => entry.kind === "string" && entry.type === "text/plain",
  );
  if (!item) return Promise.resolve("");
  return new Promise<string>((resolve) => item.getAsString((value) => resolve(value ?? "")));
}

function hasClipboardTextItem(data: DataTransfer) {
  return Array.from(data.items).some(
    (entry) => entry.kind === "string" && entry.type === "text/plain",
  );
}

async function resolveClipboardPlainText(
  eventText: string,
  eventHtml: string,
  itemTextPromise?: Promise<string>,
) {
  let best = eventText;

  try {
    const itemText = await itemTextPromise;
    if (itemText && itemText.length > best.length) best = itemText;
  } catch {
    /* Ignore unavailable clipboard item data. */
  }

  try {
    const direct = await navigator.clipboard?.readText?.();
    if (direct && direct.length > best.length) best = direct;
  } catch {
    /* Browser may deny async clipboard reads; the paste event data is still used. */
  }

  try {
    const clipboard = navigator.clipboard as Clipboard & {
      read?: () => Promise<Array<{ types: string[]; getType: (type: string) => Promise<Blob> }>>;
    };
    const items = await clipboard.read?.();
    for (const item of items ?? []) {
      if (!item.types.includes("text/plain")) continue;
      const blob = await item.getType("text/plain");
      const blobText = await blob.text();
      if (blobText.length > best.length) best = blobText;
      break;
    }
  } catch {
    /* Some browsers expose readText but not read(); keep the best text found. */
  }

  if (eventHtml) {
    const textLines = countLineBreaks(best);
    const htmlLines = estimateHtmlLineBreaks(eventHtml);
    if (!best || htmlLines > textLines + 20) {
      const htmlText = clipboardHtmlToPlainText(eventHtml);
      if (htmlText.length > best.length) best = htmlText;
    }
  }

  return best;
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
  listDeletedNotebooks,
  restoreNotebook,
  purgeNotebook,
  listDeletedNotes,
  restoreNote,
  purgeNote,
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
  Trash,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
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

  const notebooksQ = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => listNotebooks(),
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const notesQ = useQuery({
    queryKey: ["notes"],
    queryFn: () => listAllNotes(),
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  // Cross-device sync: refetch when any notebook/note row changes on the server.
  useEffect(() => {
    const channel = supabase
      .channel("notes-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "notebooks" }, () => {
        qc.invalidateQueries({ queryKey: ["notebooks"] });
        qc.invalidateQueries({ queryKey: ["deletedNotebooks"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["notes"] });
        qc.invalidateQueries({ queryKey: ["deletedNotes"] });
        const row = (payload.new ?? payload.old) as { id?: string } | null;
        if (row?.id) qc.invalidateQueries({ queryKey: ["note", row.id] });
      })
      .subscribe();
    // Also refetch when the tab becomes visible (covers realtime gaps).
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        qc.invalidateQueries({ queryKey: ["notebooks"] });
        qc.invalidateQueries({ queryKey: ["notes"] });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc]);

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
      qc.invalidateQueries({ queryKey: ["deletedNotebooks"] });
      navigate({ to: "/", search: {} });
      toast.success("Notebook moved to Trash. Restore within 30 days.");
    },
  });

  const restoreNotebookM = useMutation({
    mutationFn: (id: string) => restoreNotebook({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notebooks"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["deletedNotebooks"] });
      toast.success("Notebook restored.");
    },
  });

  const purgeNotebookM = useMutation({
    mutationFn: (id: string) => purgeNotebook({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deletedNotebooks"] });
      toast.success("Notebook permanently deleted.");
    },
  });

  const restoreNoteM = useMutation({
    mutationFn: (id: string) => restoreNote({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["deletedNotes"] });
      toast.success("Note restored.");
    },
  });

  const purgeNoteM = useMutation({
    mutationFn: (id: string) => purgeNote({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deletedNotes"] });
      toast.success("Note permanently deleted.");
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
      qc.invalidateQueries({ queryKey: ["deletedNotes"] });
      navigate({ to: "/", search: { nb: activeNotebookId } });
      toast.success("Note moved to Trash. Restore within 30 days.");
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
          <div className="flex items-center gap-0.5">
            <TrashDialog
              onRestoreNotebook={(id) => restoreNotebookM.mutate(id)}
              onPurgeNotebook={(id) => purgeNotebookM.mutate(id)}
              onRestoreNote={(id) => restoreNoteM.mutate(id)}
              onPurgeNote={(id) => purgeNoteM.mutate(id)}
            />
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleNewNotebook}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
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
          <div className="flex items-center gap-0.5">
            <TrashDialog
              defaultTab="notes"
              onRestoreNotebook={(id) => restoreNotebookM.mutate(id)}
              onPurgeNotebook={(id) => purgeNotebookM.mutate(id)}
              onRestoreNote={(id) => restoreNoteM.mutate(id)}
              onPurgeNote={(id) => purgeNoteM.mutate(id)}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={!activeNotebookId}
              onClick={() =>
                activeNotebookId &&
                newNoteM.mutate({ notebook_id: activeNotebookId, title: "" })
              }
            >
              <FilePlus className="h-4 w-4" />
            </Button>
          </div>
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
                    newNoteM.mutate({ notebook_id: activeNotebookId, title: "" })
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

function TrashDialog({
  onRestoreNotebook,
  onPurgeNotebook,
  onRestoreNote,
  onPurgeNote,
  defaultTab = "notebooks",
}: {
  onRestoreNotebook: (id: string) => void;
  onPurgeNotebook: (id: string) => void;
  onRestoreNote: (id: string) => void;
  onPurgeNote: (id: string) => void;
  defaultTab?: "notebooks" | "notes";
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"notebooks" | "notes">(defaultTab);


  const deletedNotebooksQ = useQuery({
    queryKey: ["deletedNotebooks"],
    queryFn: () => listDeletedNotebooks(),
    enabled: open,
  });
  const deletedNotesQ = useQuery({
    queryKey: ["deletedNotes"],
    queryFn: () => listDeletedNotes(),
    enabled: open,
  });

  const notebookItems = (deletedNotebooksQ.data ?? []) as {
    id: string;
    name: string;
    deleted_at: string;
  }[];
  const noteItems = (deletedNotesQ.data ?? []) as {
    id: string;
    title: string;
    deleted_at: string;
    notebook_name: string;
  }[];

  const daysLeft = (iso: string) => {
    const end = new Date(iso).getTime() + 30 * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  };

  const activeQ = tab === "notebooks" ? deletedNotebooksQ : deletedNotesQ;
  const isEmpty =
    tab === "notebooks" ? notebookItems.length === 0 : noteItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-6 w-6" title="Trash">
          <Trash className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Deleted items are kept for 30 days, then permanently removed.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-2 inline-flex rounded-md border p-0.5 text-xs">
          <button
            className={`rounded px-3 py-1 ${tab === "notebooks" ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setTab("notebooks")}
          >
            Notebooks
          </button>
          <button
            className={`rounded px-3 py-1 ${tab === "notes" ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setTab("notes")}
          >
            Notes
          </button>
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {activeQ.isLoading && (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {!activeQ.isLoading && isEmpty && (
            <p className="py-6 text-center text-sm text-muted-foreground">Trash is empty.</p>
          )}
          {tab === "notebooks" &&
            notebookItems.map((nb) => (
              <div key={nb.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{nb.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {daysLeft(nb.deleted_at)} day{daysLeft(nb.deleted_at) === 1 ? "" : "s"} left
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onRestoreNotebook(nb.id)}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Restore
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Permanently delete "${nb.name}"? This cannot be undone.`)) {
                      onPurgeNotebook(nb.id);
                    }
                  }}
                  title="Delete forever"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          {tab === "notes" &&
            noteItems.map((n) => (
              <div key={n.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{n.title || "Untitled"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {n.notebook_name} · {daysLeft(n.deleted_at)} day
                    {daysLeft(n.deleted_at) === 1 ? "" : "s"} left
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onRestoreNote(n.id)}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Restore
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Permanently delete "${n.title}"? This cannot be undone.`)) {
                      onPurgeNote(n.id);
                    }
                  }}
                  title="Delete forever"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}


/* -------------------- Note Editor with undo/redo/commit/rollback -------------------- */

function NoteEditor({ noteId }: { noteId: string }) {
  const qc = useQueryClient();
  const noteQ = useQuery({ queryKey: ["note", noteId], queryFn: () => getNote({ data: { id: noteId } }) });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // Separate source that drives the hidden MarkdownView -> editable sync.
  // Only updated on external changes (initial load, undo/redo, rollback) so
  // typing/pasting large content does NOT re-run ReactMarkdown on every keystroke.
  const [externalContent, setExternalContent] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [plainTextMode, setPlainTextMode] = useState(false);

  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushedRef = useRef<string>("");
  const hydratedRef = useRef(false);

  const editableRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastRenderedRef = useRef<string | null>(null);
  const largePasteRef = useRef(false);
  const bulkPasteRef = useRef(false);
  const localChangeRef = useRef(false);
  const saveSeqRef = useRef(0);

  // Auto-grow textarea (large-document plain-text mode) so the outer scroll
  // container handles overflow instead of clipping the content.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 400)}px`;
  }, [content]);

  useEffect(() => {
    if (!noteQ.data) return;
    if (hydratedRef.current && localChangeRef.current) return;
    hydratedRef.current = true;
    setTitle(noteQ.data.title);
    setContent(noteQ.data.content);
    setExternalContent(noteQ.data.content);
    setPlainTextMode(
      noteQ.data.content.length === 0 ||
        noteQ.data.content.length >= LARGE_CONTENT_LIMIT ||
        (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches),
    );
    undoStack.current = [noteQ.data.content];
    redoStack.current = [];
    lastPushedRef.current = noteQ.data.content;
    localChangeRef.current = false;
    setSaveState("saved");
  }, [noteQ.data]);

  // Sync rendered HTML into the editable div whenever externalContent changes
  // (initial load, undo/redo, rollback). Internal typing sets lastRenderedRef
  // first to avoid wiping the user's caret.
  useEffect(() => {
    if (lastRenderedRef.current === externalContent) return;
    if (externalContent.length > LARGE_CONTENT_LIMIT) {
      lastRenderedRef.current = externalContent;
      return;
    }
    requestAnimationFrame(() => {
      if (!hiddenRef.current || !editableRef.current) return;
      const html = hiddenRef.current.innerHTML || "<p><br/></p>";
      editableRef.current.innerHTML = html;
      ensureTrailingParagraph(editableRef.current);
      lastRenderedRef.current = externalContent;
    });
  }, [externalContent]);




  const pushHistory = useCallback((value: string) => {
    const last = lastPushedRef.current;
    if (value === last) return;
    if (value.length > LARGE_CONTENT_LIMIT || last.length > LARGE_CONTENT_LIMIT) {
      undoStack.current = [value];
      redoStack.current = [];
      lastPushedRef.current = value;
      return;
    }
    undoStack.current.push(value);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    lastPushedRef.current = value;
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(
    (next: { title?: string; content?: string }) => {
      setSaveState("saving");
      const seq = ++saveSeqRef.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await updateNote({ data: { id: noteId, ...next } });
          if (seq === saveSeqRef.current) {
            // Keep localChangeRef=true for the lifetime of this note editor
            // (the component is keyed by noteId, so it remounts on switch).
            // Resetting it here caused a race: a remote refetch fired by our
            // own realtime broadcast — or by a subsequent edit — could
            // overwrite freshly-typed/pasted content with the just-saved value,
            // making new pastes appear to vanish until refresh.
            setSaveState("saved");
          }
        } catch (e) {
          if (seq === saveSeqRef.current) setSaveState("dirty");
          toast.error(e instanceof Error ? e.message : "Save failed");
        }
      }, 700);
    },
    [noteId, qc],
  );

  const onContentChange = useCallback(
    (v: string) => {
      localChangeRef.current = true;
      setContent(v);
      setSaveState("dirty");
      const last = lastPushedRef.current;
      if (Math.abs(v.length - last.length) > 30 || /\s$/.test(v) !== /\s$/.test(last)) {
        pushHistory(v);
      }
      scheduleSave({ content: v });
    },
    [pushHistory, scheduleSave],
  );

  const onTitleChange = (v: string) => {
    localChangeRef.current = true;
    setTitle(v);
    setSaveState("dirty");
    scheduleSave({ title: v });
  };

  const isLargeDocument = content.length >= LARGE_CONTENT_LIMIT;
  const usePlainTextEditor = plainTextMode || isLargeDocument;
  const lineNumbers = useMemo(
    () =>
      Array.from(
        { length: Math.max(1, countLineBreaks(content) + 1) },
        (_, i) => i + 1,
      ).join("\n"),
    [content],
  );

  const onPlainTextChange = useCallback(
    (v: string) => {
      setPlainTextMode(true);
      onContentChange(v);
      if (v.length < LARGE_CONTENT_LIMIT) {
        setExternalContent(v);
        lastRenderedRef.current = null;
        largePasteRef.current = false;
      } else {
        largePasteRef.current = true;
        lastRenderedRef.current = v;
      }
    },
    [onContentChange],
  );

  const handleFilesSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) return;
      try {
        const parts: string[] = [];
        for (const file of files) {
          const text = await file.text();
          const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
          const codeExts = new Set([
            "js","jsx","ts","tsx","mjs","cjs","py","rb","go","rs","java","kt","swift",
            "c","h","cpp","hpp","cc","cs","php","sh","bash","zsh","ps1","sql","html",
            "htm","css","scss","sass","less","vue","svelte","astro","graphql","proto",
            "json","xml","yml","yaml","toml","ini","dockerfile","csv","tsv",
          ]);
          const isCode = codeExts.has(ext);
          const fenceLang = isCode ? (ext === "tsx" || ext === "jsx" ? ext : ext) : "";
          const block = isCode
            ? `\n\n\`\`\`${fenceLang}\n${text}\n\`\`\`\n`
            : `\n\n${text}\n`;
          parts.push(`\n\n<!-- ${file.name} -->${block}`);
        }
        const appended = parts.join("");
        const next = (content ? content : "") + appended;
        onPlainTextChange(next);
        toast.success(`Inserted ${files.length} file${files.length > 1 ? "s" : ""}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to read file");
      }
    },
    [content, onPlainTextChange],
  );

  // Capture current HTML from the editable, convert to markdown, and save —
  // without triggering a re-render of the editable (which would lose the caret).
  // Debounced capture: converting a very large innerHTML to markdown is
  // expensive; coalesce rapid input/paste events so we don't block the UI
  // on every keystroke.
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runCapture = useCallback(() => {
    if (!editableRef.current) return;
    const textSize = editableRef.current.textContent?.length ?? 0;
    const md =
      largePasteRef.current || textSize > LARGE_CONTENT_LIMIT
        ? editableToPlainText(editableRef.current)
        : htmlToMarkdown(editableRef.current.innerHTML);
    lastRenderedRef.current = md;
    largePasteRef.current = md.length > LARGE_CONTENT_LIMIT;
    onContentChange(md);
  }, [onContentChange]);
  const captureFromEditable = useCallback(() => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(runCapture, 200);
  }, [runCapture]);


  const runExec = (cmd: string, val?: string) => {
    if (usePlainTextEditor) return;
    editableRef.current?.focus();
    try {
      document.execCommand(cmd, false, val);
    } catch {
      /* ignore */
    }
    captureFromEditable();
  };

  const wrapSelectionWithStyle = (style: string) => {
    if (usePlainTextEditor) return;
    editableRef.current?.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      toast.message("Select some text first");
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editableRef.current?.contains(range.commonAncestorContainer)) return;
    const span = document.createElement("span");
    span.setAttribute("style", style);
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
    } catch {
      /* ignore */
    }
    captureFromEditable();
  };

  const insertBold = () => runExec("bold");
  const insertItalic = () => runExec("italic");
  const setTextColor = (color: string) => runExec("foreColor", color);
  const setBgColor = (color: string) => {
    if (usePlainTextEditor) return;
    editableRef.current?.focus();
    try {
      if (!document.execCommand("hiliteColor", false, color)) {
        document.execCommand("backColor", false, color);
      }
    } catch {
      /* ignore */
    }
    captureFromEditable();
  };
  const setFontSize = (size: string) => wrapSelectionWithStyle(`font-size:${size}`);

  const insertTable = (rows: number, cols: number) => {
    if (usePlainTextEditor) return;
    editableRef.current?.focus();
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) html += `<th>Header ${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br/></p>';
    try {
      document.execCommand("insertHTML", false, html);
    } catch {
      /* ignore */
    }
    captureFromEditable();
  };

  const doUndo = () => {
    if (undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    lastPushedRef.current = prev;
    setContent(prev);
    setExternalContent(prev);
    scheduleSave({ content: prev });
  };

  const doRedo = () => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(next);
    lastPushedRef.current = next;
    setContent(next);
    setExternalContent(next);
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
      setExternalContent(c);
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
          <div className="mx-1 h-5 w-px bg-border" />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.log,.csv,.tsv,.json,.xml,.yml,.yaml,.toml,.ini,.env,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cc,.cs,.php,.sh,.bash,.zsh,.ps1,.sql,.html,.htm,.css,.scss,.sass,.less,.vue,.svelte,.astro,.graphql,.proto,.dockerfile,text/*,application/json,application/xml,application/x-yaml,application/sql"
            className="hidden"
            onChange={handleFilesSelected}
          />
          <ToolbarBtn label="Upload text / code files" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            <span className="ml-1 hidden text-xs sm:inline">Upload</span>
          </ToolbarBtn>
        </div>
      </TooltipProvider>


      <div className="flex flex-1 overflow-hidden">
        <ScrollArea className="h-full flex-1">

          {/* Hidden renderer — produces formatted HTML from markdown source */}
          <div ref={hiddenRef} className="hidden" aria-hidden>
            {!usePlainTextEditor && <MarkdownView source={externalContent} />}
          </div>
          {usePlainTextEditor ? (
            <div className="mx-auto flex w-full max-w-5xl items-stretch bg-background">
              <pre
                aria-hidden
                className="select-none py-4 pl-3 pr-2 text-right font-mono text-sm leading-6 text-muted-foreground/70 tabular-nums sm:py-6"
                style={{ margin: 0 }}
              >
                {lineNumbers}
              </pre>
              <textarea
                ref={textareaRef}
                value={content}
                spellCheck={false}
                onChange={(e) => onPlainTextChange(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text/plain");
                  const html = e.clipboardData.getData("text/html");
                  const itemText = readClipboardItemText(e.clipboardData);
                  const ta = e.currentTarget;
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  e.preventDefault();
                  void (async () => {
                    const full = await resolveClipboardPlainText(text, html, itemText);
                    if (!full) return;
                    const next = content.slice(0, start) + full + content.slice(end);
                    onPlainTextChange(next);
                    requestAnimationFrame(() => {
                      const el = textareaRef.current;
                      if (!el) return;
                      const pos = start + full.length;
                      el.selectionStart = el.selectionEnd = pos;
                    });
                  })();
                }}
                className="block flex-1 resize-none overflow-hidden bg-background py-4 pl-3 pr-4 font-mono text-sm leading-6 outline-none sm:py-6 sm:pr-6"
              />
            </div>
          ) : (
            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck
              onInput={() => {
                if (bulkPasteRef.current) return;
                if (editableRef.current) ensureTrailingParagraph(editableRef.current);
                captureFromEditable();
              }}
              onBlur={() => pushHistory(content)}
              onKeyDown={(e) => {
                // Escape table on Enter at end of last cell
                if (e.key === "Enter" && !e.shiftKey) {
                  const sel = window.getSelection();
                  if (!sel || sel.rangeCount === 0) return;
                  const node = sel.getRangeAt(0).startContainer;
                  const cell = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest("td,th");
                  if (!cell) return;
                  const table = cell.closest("table");
                  const lastRow = table?.querySelector("tr:last-child");
                  const isLastCell = lastRow && cell === lastRow.lastElementChild;
                  if (isLastCell) {
                    e.preventDefault();
                    const p = document.createElement("p");
                    p.innerHTML = "<br/>";
                    table!.parentNode!.insertBefore(p, table!.nextSibling);
                    const r = document.createRange();
                    r.setStart(p, 0);
                    r.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(r);
                    captureFromEditable();
                  }
                }
              }}
              onMouseDown={(e) => {
                const root = editableRef.current;
                if (!root) return;
                const last = root.lastElementChild as HTMLElement | null;
                if (!last) return;
                const lastRect = last.getBoundingClientRect();
                // Click below last block → ensure trailing paragraph and move caret there
                if (e.clientY > lastRect.bottom) {
                  e.preventDefault();
                  let trailing = root.lastElementChild as HTMLElement | null;
                  if (!trailing || trailing.tagName !== "P") {
                    trailing = document.createElement("p");
                    trailing.innerHTML = "<br/>";
                    root.appendChild(trailing);
                  }
                  root.focus({ preventScroll: true });
                  const sel = window.getSelection();
                  if (sel) {
                    const r = document.createRange();
                    r.setStart(trailing, 0);
                    r.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(r);
                  }
                  captureFromEditable();
                }
              }}
              onPaste={(e) => {
                const html = e.clipboardData.getData("text/html");
                const text = e.clipboardData.getData("text/plain");
                const hasTextItem = hasClipboardTextItem(e.clipboardData);
                // Large pastes bypass the DOM entirely. Rendering hundreds of
                // thousands of characters into contentEditable is what freezes
                // the page, so switch to the plain-text editor immediately.
                if (
                  (text.length >= RICH_TEXT_PASTE_LIMIT || html.length >= RICH_TEXT_PASTE_LIMIT || (!text && !html && hasTextItem)) &&
                  editableRef.current
                ) {
                  e.preventDefault();
                  const root = editableRef.current;
                  const itemText = readClipboardItemText(e.clipboardData);
                  const current = editableToPlainText(root);
                  const { start, end } = getEditableSelectionOffsets(root, current.length);
                  void (async () => {
                    const fullText = await resolveClipboardPlainText(text, html, itemText);
                    if (!fullText) return;
                    const next = `${current.slice(0, start)}${fullText}${current.slice(end)}`;
                    onPlainTextChange(next);
                  })();
                  return;
                }

                if (html && html.length < RICH_TEXT_PASTE_LIMIT) {
                  e.preventDefault();
                  try {
                    document.execCommand("insertHTML", false, html);
                  } catch {
                    /* ignore */
                  }
                }
                // else: let the browser handle small plain-text paste natively
                if (editableRef.current) ensureTrailingParagraph(editableRef.current);
                captureFromEditable();
              }}

              className="prose prose-slate dark:prose-invert mx-auto min-h-full max-w-3xl p-4 outline-none focus:outline-none sm:p-6 prose-headings:font-semibold prose-h1:text-3xl prose-h1:mt-6 prose-h1:mb-4 prose-h2:text-2xl prose-h2:mt-6 prose-h2:mb-3 prose-h3:text-xl prose-h3:mt-5 prose-h3:mb-2 prose-p:my-3 prose-p:leading-7 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-table:my-4 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-4 prose-blockquote:border-primary/40 prose-blockquote:pl-4 prose-blockquote:italic prose-hr:my-6 prose-strong:font-semibold prose-a:text-primary"
            />
          )}
        </ScrollArea>
        <TocPanel content={content} editableRef={editableRef} />
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
        {source || ""}
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

/* -------------------- Dynamic Table of Contents -------------------- */

type TocItem = { level: number; text: string; index: number };

function parseToc(md: string): TocItem[] {
  const items: TocItem[] = [];
  const lines = md.split("\n");
  let inFence = false;
  let idx = 0;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      items.push({ level: m[1].length, text: m[2].trim(), index: idx++ });
    }
  }
  return items;
}

function TocPanel({
  content,
  editableRef,
}: {
  content: string;
  editableRef: React.RefObject<HTMLDivElement | null>;
}) {
  const items = useMemo(
    () => (content.length > LARGE_TOC_PARSE_LIMIT ? [] : parseToc(content)),
    [content],
  );
  const [open, setOpen] = useState(true);

  const jumpTo = (item: TocItem) => {
    const root = editableRef.current;
    if (!root) return;
    const headings = Array.from(
      root.querySelectorAll<HTMLElement>("h1, h2, h3"),
    );
    // Prefer same-level match by index; else fall back to text match.
    const sameLevel = headings.filter(
      (h) => Number(h.tagName.substring(1)) === item.level,
    );
    let target =
      sameLevel[
        items.filter((i) => i.level === item.level).findIndex((i) => i === item)
      ];
    if (!target) {
      target = headings.find(
        (h) => h.textContent?.trim() === item.text,
      ) as HTMLElement | undefined ?? headings[item.index];
    }
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("ring-2", "ring-primary/40", "rounded");
    setTimeout(() => {
      target?.classList.remove("ring-2", "ring-primary/40", "rounded");
    }, 1200);
  };

  return (
    <aside
      className={`hidden shrink-0 border-l bg-muted/20 lg:flex lg:flex-col ${open ? "w-60" : "w-10"}`}
    >
      <div className="flex items-center justify-between border-b px-2 py-2">
        {open && (
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Contents
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setOpen((v) => !v)}
          title={open ? "Hide contents" : "Show contents"}
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>
      {open && (
        <ScrollArea className="flex-1">
          <nav className="p-2">
            {items.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                Add headings (#, ##, ###) to see them here.
              </p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {items.map((it, i) => (
                  <li key={i}>
                    <button
                      onClick={() => jumpTo(it)}
                      className="w-full truncate rounded px-2 py-1 text-left hover:bg-accent"
                      style={{ paddingLeft: `${(it.level - 1) * 12 + 8}px` }}
                      title={it.text}
                    >
                      {it.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </ScrollArea>
      )}
    </aside>
  );
}
