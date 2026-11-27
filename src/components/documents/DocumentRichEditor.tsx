"use client";

// ============================================================
// DocumentRichEditor — Tiptap/ProseMirror editing surface
// Replaces the legacy plain <textarea> on the document page.
// Content stays canonical PLAIN TEXT (paragraphs = blank lines)
// so word counts, fact claims, and saved versions are unchanged.
//
// Inline AI rewrite: a floating "Rewrite with AI" popover anchored
// to the text selection. The highlighted range is a ProseMirror
// inline Decoration (persists while focus moves into the popover),
// shimmers while OpenAI works, and a replaced span gets a brief
// reveal sweep. Replace is a single undoable transaction.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text → minimal HTML: blank-line-separated paragraphs,
 * single newlines become <br>. */
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim());
  return paragraphs
    .filter(p => p.length > 0)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("") || "<p></p>";
}

/** ProseMirror doc → canonical plain text (blank line between blocks). */
function editorToText(editor: any): string {
  return editor.getText({ blockSeparator: "\n\n" });
}

/** Plain-text offset of a doc position — must match editorToText output. */
function textOffsetOf(doc: any, pos: number): number {
  return doc.textBetween(0, pos, "\n\n", "\n").length;
}

// ---------- Persistent selection highlight plugin ----------

type DecoMode = "sel" | "loading" | "reveal";
const IR_KEY = new PluginKey<{ from: number; to: number; mode: DecoMode } | null>("inlineRewrite");

const InlineRewriteHighlight = Extension.create({
  name: "inlineRewriteHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<{ from: number; to: number; mode: DecoMode } | null>({
        key: IR_KEY,
        state: {
          init: () => null,
          apply: (tr, cur) => {
            const meta = tr.getMeta(IR_KEY);
            if (meta?.type === "clear") return null;
            if (meta?.type === "set") return { from: meta.from, to: meta.to, mode: meta.mode ?? "sel" };
            if (cur && tr.docChanged) {
              const from = tr.mapping.map(cur.from, -1);
              const to = tr.mapping.map(cur.to, 1);
              return from < to ? { ...cur, from, to } : null;
            }
            return cur;
          },
        },
        props: {
          decorations(state) {
            const cur = IR_KEY.getState(state);
            if (!cur) return null;
            if (cur.mode === "reveal") {
              // Blur-to-sharp cascade: split the replaced span into ~4-word
              // chunks, each with a stepped animation-delay for the
              // left-to-right reveal. Chunked at word boundaries so the
              // sweep reads as word-by-word, never mid-word.
              const chunks: { a: number; b: number }[] = [];
              state.doc.nodesBetween(cur.from, cur.to, (node, pos) => {
                if (!node.isText || !node.text) return;
                const a0 = Math.max(pos, cur!.from) - pos;
                const b0 = Math.min(pos + node.nodeSize, cur!.to) - pos;
                const t = node.text.slice(a0, b0);
                const re = /\s+/g;
                let segStart = 0, words = 0, m: RegExpExecArray | null;
                while ((m = re.exec(t))) {
                  if (m.index > segStart && ++words % 4 === 0) {
                    chunks.push({ a: pos + a0 + segStart, b: pos + a0 + m.index });
                    segStart = m.index;
                  }
                }
                if (segStart < t.length) chunks.push({ a: pos + a0 + segStart, b: pos + a0 + t.length });
              });
              return DecorationSet.create(state.doc,
                chunks
                  .filter(c => c.a < c.b)
                  .map((c, i) => Decoration.inline(c.a, c.b, {
                    class: "ir-reveal",
                    style: `animation-delay:${Math.min(i * 90, 1200)}ms`,
                  })));
            }
            const cls = cur.mode === "loading" ? "ir-loading" : "ir-sel";
            return DecorationSet.create(state.doc, [
              Decoration.inline(cur.from, cur.to, { class: cls }),
            ]);
          },
        },
      }),
    ];
  },
});

// ---------- Popover state ----------

type IrPhase = "pill" | "open" | "loading" | "preview";
interface IrState {
  phase: IrPhase;
  from: number;
  to: number;
  left: number;
  top: number;
  below: boolean;
  selectedText: string;
  rewritten?: string;
  error?: string;
}

const QUICK_ACTIONS = [
  { label: "Improve flow", instruction: "Improve flow and narrative cohesion." },
  { label: "Make concise", instruction: "Make it more concise without losing meaning or facts." },
  { label: "More natural", instruction: "Make it sound more natural and human." },
  { label: "Fix grammar", instruction: "Fix grammar and punctuation only — keep everything else identical." },
];

const POPOVER_W = 340;
const CARD_EST_H = 300;

/** Viewport-clamped anchor for the popover, above the selection when it fits. */
function anchorFor(editor: any, from: number, to: number, tall: boolean): { left: number; top: number; below: boolean } {
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const estH = tall ? CARD_EST_H : 44;
  const below = start.top - 10 - estH < 8;
  const left = Math.min(Math.max(start.left, 8), Math.max(8, window.innerWidth - POPOVER_W - 8));
  return { left, top: below ? end.bottom + 8 : start.top - 10, below };
}

export function DocumentRichEditor({
  content,
  onChange,
  readOnly = false,
  placeholder = "Edit document content...",
  documentId,
}: {
  content: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** Enables the "Rewrite with AI" selection popover when provided. */
  documentId?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [ir, setIr] = useState<IrState | null>(null);
  const [instruction, setInstruction] = useState("");
  const irRef = useRef<IrState | null>(null);
  irRef.current = ir;
  const abortRef = useRef<AbortController | null>(null);

  const setDeco = useCallback((editor: any, from: number, to: number, mode: DecoMode) => {
    editor.view.dispatch(editor.state.tr.setMeta(IR_KEY, { type: "set", from, to, mode }));
  }, []);
  const clearDeco = useCallback((editor: any) => {
    editor.view.dispatch(editor.state.tr.setMeta(IR_KEY, { type: "clear" }));
  }, []);

  const closeIr = useCallback((editor: any) => {
    abortRef.current?.abort();
    setIr(null);
    setInstruction("");
    clearDeco(editor);
  }, [clearDeco]);

  const editor = useEditor({
    extensions: [StarterKit, InlineRewriteHighlight],
    content: textToHtml(content),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const text = editorToText(editor);
      if (text !== content) onChange(text);
    },
    onSelectionUpdate: ({ editor }) => {
      const cur = irRef.current;
      const { from, to, empty } = editor.state.selection;
      if (!documentId || readOnly) return;
      if (empty) {
        // Only the idle pill follows the selection; open cards keep their highlight.
        if (cur?.phase === "pill") { setIr(null); clearDeco(editor); }
        return;
      }
      const selected = editor.state.doc.textBetween(from, to, "\n\n", "\n");
      if (selected.length < 2) {
        if (cur?.phase === "pill") { setIr(null); clearDeco(editor); }
        return;
      }
      if (cur && cur.phase !== "pill") return; // a card is open — ignore new selections
      const anchor = anchorFor(editor, from, to, false);
      setIr(prev => prev?.phase === "pill" && prev.from === from && prev.to === to
        ? prev
        : { phase: "pill", from, to, ...anchor, selectedText: selected });
      setDeco(editor, from, to, "sel");
    },
    editorProps: {
      attributes: {
        class: "document-prosemirror outline-none min-h-[400px] px-4 py-3 text-sm leading-relaxed text-dvivid-text-primary",
      },
    },
  });

  // Sync readOnly
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Close the popover when switching to read-only or swapping versions.
  useEffect(() => {
    if (editor && (readOnly || !documentId) && irRef.current) closeIr(editor);
  }, [editor, readOnly, documentId, closeIr]);

  // Sync external content (version switch) — only when it differs
  // from what the editor currently holds.
  useEffect(() => {
    if (!editor) return;
    if (editorToText(editor) !== content) {
      if (irRef.current) closeIr(editor);
      editor.commands.setContent(textToHtml(content), false);
    }
  }, [editor, content, closeIr]);

  async function runRewrite(instr: string) {
    const cur = irRef.current;
    if (!editor || !cur) return;
    const { from, to } = cur;
    const doc = editor.state.doc;
    const selectedText = doc.textBetween(from, to, "\n\n", "\n");
    const body = {
      fullText: editorToText(editor),
      selectionStart: textOffsetOf(doc, from),
      selectionEnd: textOffsetOf(doc, to),
      selectedText,
      instruction: instr.trim() || undefined,
    };
    const anchor = anchorFor(editor, from, to, true);
    setIr({ phase: "loading", from, to, ...anchor, selectedText });
    setDeco(editor, from, to, "loading");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/documents/${documentId}/inline-rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Rewrite failed — please try again");
      if (!data.rewrittenText) throw new Error("The model returned an empty rewrite");
      setIr({ phase: "preview", from, to, ...anchor, selectedText, rewritten: data.rewrittenText });
      setDeco(editor, from, to, "sel");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setIr({ phase: "open", from, to, ...anchor, selectedText, error: e?.message || "Rewrite failed" });
      setDeco(editor, from, to, "sel");
    }
  }

  function applyRewrite() {
    const cur = irRef.current;
    if (!editor || !cur?.rewritten) return;
    const { from, to, rewritten, selectedText } = cur;
    // The decoration maps with edits, but confirm the span still holds the
    // text we rewrote before replacing — never clobber newer edits.
    if (editor.state.doc.textBetween(from, to, "\n\n", "\n") !== selectedText) {
      setIr({ ...cur, error: "The selected text changed — please re-select and try again." });
      return;
    }
    const oldSize = editor.state.doc.content.size;
    editor.chain().insertContentAt({ from, to }, textToHtml(rewritten)).run();
    const insertedEnd = to + (editor.state.doc.content.size - oldSize);
    setIr(null);
    setInstruction("");
    setDeco(editor, from, insertedEnd, "reveal");
    setTimeout(() => { if (editor && !editor.isDestroyed) clearDeco(editor); }, 1300);
  }

  if (!editor) return null;

  const btn = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
      active
        ? "bg-dvivid-primary-light text-dvivid-primary border-dvivid-primary/40"
        : "text-dvivid-text-secondary border-dvivid-border-light hover:bg-gray-50"
    }`;

  const chain = () => editor.chain().focus();

  const spring = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 500, damping: 34, mass: 0.9 };
  const enter = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 };
  const shown = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const leave = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 };
  const tooLong = ir ? ir.selectedText.length > 3_000 : false;

  return (
    <div className={`border rounded-input overflow-hidden ${readOnly ? "border-dvivid-border-light bg-gray-50" : "border-dvivid-border bg-white"}`}>
      {/* Toolbar — visible only when editing */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-dvivid-border-light bg-gray-50">
          <button type="button" title="Undo" onClick={() => chain().undo().run()}
            disabled={!editor.can().undo()} className={btn(false) + " disabled:opacity-40"}>↶</button>
          <button type="button" title="Redo" onClick={() => chain().redo().run()}
            disabled={!editor.can().redo()} className={btn(false) + " disabled:opacity-40"}>↷</button>
          <span className="w-px h-4 bg-dvivid-border-light mx-1" />
          <button type="button" title="Bold" onClick={() => chain().toggleBold().run()}
            className={btn(editor.isActive("bold"))}><b>B</b></button>
          <button type="button" title="Italic" onClick={() => chain().toggleItalic().run()}
            className={btn(editor.isActive("italic"))}><i>I</i></button>
          <span className="w-px h-4 bg-dvivid-border-light mx-1" />
          <select
            title="Paragraph style"
            className="px-2 py-1 text-xs border border-dvivid-border-light rounded bg-white text-dvivid-text-secondary"
            value={
              editor.isActive("heading", { level: 1 }) ? "h1"
              : editor.isActive("heading", { level: 2 }) ? "h2"
              : editor.isActive("heading", { level: 3 }) ? "h3"
              : "p"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") chain().setParagraph().run();
              else chain().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
          >
            <option value="p">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          <span className="w-px h-4 bg-dvivid-border-light mx-1" />
          <button type="button" title="Bullet list" onClick={() => chain().toggleBulletList().run()}
            className={btn(editor.isActive("bulletList"))}>• List</button>
          <button type="button" title="Numbered list" onClick={() => chain().toggleOrderedList().run()}
            className={btn(editor.isActive("orderedList"))}>1. List</button>
          <button type="button" title="Blockquote" onClick={() => chain().toggleBlockquote().run()}
            className={btn(editor.isActive("blockquote"))}>❝</button>
          <span className="w-px h-4 bg-dvivid-border-light mx-1" />
          <button type="button" title="Clear formatting"
            onClick={() => chain().unsetAllMarks().clearNodes().run()}
            className={btn(false)}>Clear</button>
        </div>
      )}
      <EditorContent editor={editor} data-placeholder={placeholder} />

      {/* Inline AI rewrite popover — anchored to the selection rect, clamped
          to the viewport. The decoration plugin keeps the range highlighted
          while focus sits in this card. */}
      {ir && (
        <div
          className="fixed z-50"
          style={{
            left: ir.left,
            top: ir.top,
            transform: ir.below ? "none" : "translateY(-100%)",
            width: ir.phase === "pill" ? "auto" : POPOVER_W,
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {ir.phase === "pill" ? (
              <motion.button
                key="ir-pill"
                type="button"
                initial={enter}
                animate={shown}
                exit={leave}
                transition={spring}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const anchor = anchorFor(editor, ir.from, ir.to, true);
                  setIr({ ...ir, phase: "open", ...anchor });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dvivid-primary text-white text-xs font-medium shadow-lg hover:bg-dvivid-primary-dark whitespace-nowrap"
              >
                <span aria-hidden>✦</span> Rewrite with AI
              </motion.button>
            ) : (
              <motion.div
                key="ir-card"
                layout
                initial={enter}
                animate={shown}
                exit={leave}
                transition={spring}
                onKeyDown={(e) => { if (e.key === "Escape") closeIr(editor); }}
                className="ir-beam-host rounded-card"
              >
                {/* Luminous orbiting border beam + sparkles while the model works */}
                {ir.phase === "loading" && !reduceMotion && (
                  <>
                    <div className="ir-beam" aria-hidden />
                    <motion.span className="ir-sparkle" style={{ top: -7, right: 20 }}
                      animate={{ scale: [0.5, 1.2, 0.5], opacity: [0.2, 0.95, 0.2] }}
                      transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }} aria-hidden>✦</motion.span>
                    <motion.span className="ir-sparkle" style={{ bottom: -5, left: 16 }}
                      animate={{ scale: [0.5, 1.1, 0.5], opacity: [0.2, 0.85, 0.2] }}
                      transition={{ repeat: Infinity, duration: 1.9, delay: 0.5, ease: "easeInOut" }} aria-hidden>✧</motion.span>
                    <motion.span className="ir-sparkle" style={{ top: 12, left: -9 }}
                      animate={{ scale: [0.5, 1.15, 0.5], opacity: [0.2, 0.9, 0.2] }}
                      transition={{ repeat: Infinity, duration: 1.7, delay: 1, ease: "easeInOut" }} aria-hidden>✦</motion.span>
                  </>
                )}
                <div className="ir-beam-inner rounded-card border border-dvivid-border/60 shadow-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-dvivid-text-primary flex items-center gap-1.5">
                    <span aria-hidden>✦</span> Rewrite with AI
                  </span>
                  <button
                    type="button"
                    onClick={() => closeIr(editor)}
                    className="text-dvivid-text-muted hover:text-dvivid-text-secondary text-sm leading-none"
                    aria-label="Close"
                  >×</button>
                </div>

                <input
                  type="text"
                  autoFocus={ir.phase === "open"}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !tooLong && ir.phase !== "loading") runRewrite(instruction);
                    if (e.key === "Escape") closeIr(editor);
                  }}
                  placeholder="Tell AI how to rewrite this... (optional)"
                  disabled={ir.phase === "loading"}
                  className="w-full px-2.5 py-1.5 text-xs border border-dvivid-border-light rounded-input focus-ring disabled:opacity-50"
                />

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ACTIONS.map(q => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={ir.phase === "loading" || tooLong}
                      onClick={() => { setInstruction(q.instruction); runRewrite(q.instruction); }}
                      className="px-2 py-1 text-xs rounded-full border border-dvivid-border-light text-dvivid-text-secondary hover:bg-dvivid-primary-light hover:text-dvivid-primary hover:border-dvivid-primary/40 disabled:opacity-40"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

                {tooLong && (
                  <p className="text-xs text-dvivid-warning">Selection is too long (max 3,000 characters).</p>
                )}
                {ir.error && <p className="text-xs text-dvivid-error">{ir.error}</p>}

                {ir.phase === "loading" ? (
                  <div className="flex items-center gap-2 text-xs text-dvivid-text-secondary py-1">
                    <motion.span
                      aria-hidden
                      className="inline-block w-3.5 h-3.5 rounded-full border-2 border-dvivid-primary/30 border-t-dvivid-primary"
                      animate={reduceMotion ? {} : { rotate: 360 }}
                      transition={reduceMotion ? { duration: 0 } : { repeat: Infinity, duration: 0.8, ease: "linear" }}
                    />
                    Rewriting…
                  </div>
                ) : ir.phase === "preview" ? (
                  <>
                    <div className="max-h-40 overflow-y-auto rounded-input border border-dvivid-primary/25 bg-dvivid-primary-light/40 px-2.5 py-2 text-xs leading-relaxed text-dvivid-text-primary whitespace-pre-wrap">
                      {ir.rewritten}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={applyRewrite}
                        className="px-3 py-1.5 text-xs font-medium rounded-input bg-dvivid-primary text-white hover:bg-dvivid-primary-dark"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => runRewrite(instruction)}
                        className="px-3 py-1.5 text-xs font-medium rounded-input border border-dvivid-border-light text-dvivid-text-secondary hover:bg-gray-50"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => closeIr(editor)}
                        className="px-3 py-1.5 text-xs font-medium rounded-input text-dvivid-text-muted hover:text-dvivid-text-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={tooLong}
                    onClick={() => runRewrite(instruction)}
                    className="px-3 py-1.5 text-xs font-medium rounded-input bg-dvivid-primary text-white hover:bg-dvivid-primary-dark disabled:opacity-40"
                  >
                    Rewrite
                  </button>
                )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
