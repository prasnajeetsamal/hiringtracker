import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, List, ListOrdered, Heading2, Heading3, Quote, Undo2, Redo2, Minus,
} from 'lucide-react';
import clsx from 'clsx';

function ToolBtn({ active, onClick, icon: Icon, title, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={clsx(
        'p-1.5 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/80 transition disabled:opacity-40 disabled:cursor-not-allowed',
        active && 'bg-slate-800 text-slate-100'
      )}
    >
      <Icon size={14} />
    </button>
  );
}

export default function JDEditor({ value, onChange, placeholder = 'Write the job description…', minHeight = 400 }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'jd-content focus:outline-none px-4 py-3 text-slate-100 text-sm leading-relaxed',
        style: `min-height: ${minHeight}px;`,
      },
    },
  });

  // Keep editor synced when value changes externally (e.g. picking a template).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 overflow-hidden">
      <div className="flex flex-wrap gap-0.5 px-2 py-1.5 border-b border-slate-800 bg-slate-900/40">
        <ToolBtn icon={Bold}        title="Bold"        active={editor.isActive('bold')}        onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolBtn icon={Italic}      title="Italic"      active={editor.isActive('italic')}      onClick={() => editor.chain().focus().toggleItalic().run()} />
        <span className="w-px bg-slate-800 mx-1" />
        <ToolBtn icon={Heading2}    title="Heading"     active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolBtn icon={Heading3}    title="Subheading"  active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <span className="w-px bg-slate-800 mx-1" />
        <ToolBtn icon={List}        title="Bullet list" active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolBtn icon={ListOrdered} title="Number list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolBtn icon={Quote}       title="Quote"       active={editor.isActive('blockquote')}  onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolBtn icon={Minus}       title="Divider"     onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <span className="w-px bg-slate-800 mx-1" />
        <ToolBtn icon={Undo2}       title="Undo"        disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
        <ToolBtn icon={Redo2}       title="Redo"        disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
