"use client";

// ============================================================
// DocumentRichEditor — Tiptap/ProseMirror editing surface
// Replaces the legacy plain <textarea> on the document page.
// Content stays canonical PLAIN TEXT (paragraphs = blank lines)
// so word counts, fact claims, and saved versions are unchanged.
// ============================================================

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

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

export function DocumentRichEditor({
  content,
  onChange,
  readOnly = false,
  placeholder = "Edit document content...",
}: {
  content: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: textToHtml(content),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const text = editorToText(editor);
      if (text !== content) onChange(text);
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

  // Sync external content (version switch) — only when it differs
  // from what the editor currently holds.
  useEffect(() => {
    if (!editor) return;
    if (editorToText(editor) !== content) {
      editor.commands.setContent(textToHtml(content), false);
    }
  }, [editor, content]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
      active
        ? "bg-dvivid-primary-light text-dvivid-primary border-dvivid-primary/40"
        : "text-dvivid-text-secondary border-dvivid-border-light hover:bg-gray-50"
    }`;

  const chain = () => editor.chain().focus();

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
    </div>
  );
}
