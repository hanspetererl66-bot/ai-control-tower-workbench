import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FONTS, FONT_SIZES, MAX_IMAGE_DATA_URL, safeHref, safeImageSrc, sanitizeHtml } from '../doc-html';

type Props = {
  /** The document as (checked) HTML. */
  value: string;
  onChange: (html: string) => void;
  label: string;
};

const MAX_EDGE = 1200;

/** Reads an image file and shrinks it so it fits into the project store. */
async function imageFileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The image could not be read.'));
    r.readAsDataURL(file);
  });
  if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(raw)) throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('The image could not be read.'));
    i.src = raw;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && raw.length <= 400_000) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = file.type === 'image/png' && raw.length < 900_000 ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  if (out.length > MAX_IMAGE_DATA_URL) throw new Error('The image is too large. Use a smaller one.');
  return out;
}

export function RichDoc({ value, onChange, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const range = useRef<Range | null>(null);
  const dirty = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [panel, setPanel] = useState<'' | 'link' | 'image'>('');
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && value !== emitted.current && document.activeElement !== el) { el.innerHTML = value; emitted.current = value; }
    else if (el && el.innerHTML === '' && value) el.innerHTML = value;
  }, [value]);

  function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const el = ref.current;
    if (!el || !dirty.current) return;
    dirty.current = false;
    const html = sanitizeHtml(el.innerHTML);
    if (html !== emitted.current) { emitted.current = html; onChangeRef.current(html); }
  }
  function changed() {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function remember() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  }
  function restore() {
    ref.current?.focus();
    const sel = window.getSelection();
    if (sel && range.current) { sel.removeAllRanges(); sel.addRange(range.current); }
  }
  function cmd(name: string, arg?: string) {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(name, false, arg);
    remember(); changed();
  }
  function setSize(px: number) {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('fontSize', false, '7');
    ref.current?.querySelectorAll<HTMLElement>('font[size="7"], span[style*="xxx-large"], span[style*="-webkit-xxx-large"]').forEach((n) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      while (n.firstChild) span.appendChild(n.firstChild);
      n.replaceWith(span);
    });
    remember(); changed();
  }
  function insertImage(src: string, alt = '') {
    const safe = safeImageSrc(src);
    if (!safe) { setMsg('Only https addresses or images from your computer can be used.'); return; }
    if (!range.current) { setMsg('Click into the text first, where the image should go.'); return; }
    restore();
    document.execCommand('insertHTML', false, `<img src="${safe}" alt="${alt.replace(/[^\w .-]/g, '')}" width="480">`);
    setPanel(''); setUrl(''); setMsg(''); remember(); changed();
  }
  async function addFile(file: File) {
    try { insertImage(await imageFileToDataUrl(file), file.name.replace(/\.[^.]+$/, '')); } catch (e: any) { setMsg(e?.message ?? 'The image could not be added.'); }
  }
  function addLink() {
    const href = safeHref(/^[\w.-]+\.[a-z]{2,}/i.test(url.trim()) ? `https://${url.trim()}` : url);
    if (!href) { setMsg('Use an address that starts with https:// or mailto:.'); return; }
    if (!range.current) { setMsg('Click into the text first, where the link should go.'); return; }
    restore();
    const sel = window.getSelection();
    if (sel && sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${href}">${href.replace(/[<>&"]/g, '')}</a>`);
    else document.execCommand('createLink', false, href);
    setPanel(''); setUrl(''); setMsg(''); remember(); changed();
  }
  function onPaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); void addFile(file); return; }
    const html = e.clipboardData.getData('text/html');
    e.preventDefault();
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    changed();
  }
  function onDrop(e: React.DragEvent) {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); void addFile(file); }
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();
  const btn = (title: string, content: React.ReactNode, run: () => void, extra = '') => (
    <button type="button" className={`rd-btn ${extra}`} title={title} aria-label={title} onMouseDown={keep} onClick={run}>{content}</button>
  );

  return (
    <div className="rd">
      <div className="rd-bar" role="toolbar" aria-label={`Formatting for ${label}`}>
        <select className="rd-select" aria-label="Paragraph style" defaultValue="" onMouseDown={remember} onChange={(e) => { if (e.target.value) { restore(); cmd('formatBlock', e.target.value); } e.target.value = ''; }}>
          <option value="" disabled>Style</option><option value="p">Text</option><option value="h1">Title</option><option value="h2">Heading</option><option value="h3">Subheading</option>
        </select>
        <select className="rd-select" aria-label="Font" defaultValue="" onMouseDown={remember} onChange={(e) => { if (e.target.value) { restore(); cmd('fontName', e.target.value); } e.target.value = ''; }}>
          <option value="" disabled>Font</option>{FONTS.map((f) => <option key={f.label} value={f.value.split(',')[0]}>{f.label}</option>)}
        </select>
        <select className="rd-select rd-narrow" aria-label="Font size" defaultValue="" onMouseDown={remember} onChange={(e) => { if (e.target.value) { restore(); setSize(Number(e.target.value)); } e.target.value = ''; }}>
          <option value="" disabled>Size</option>{FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="rd-sep" />
        {btn('Bold (Ctrl/Cmd+B)', <b>B</b>, () => cmd('bold'))}
        {btn('Italic (Ctrl/Cmd+I)', <i>I</i>, () => cmd('italic'))}
        {btn('Underline (Ctrl/Cmd+U)', <u>U</u>, () => cmd('underline'))}
        {btn('Strikethrough', <s>S</s>, () => cmd('strikeThrough'))}
        <span className="rd-sep" />
        {btn('Bulleted list', '• List', () => cmd('insertUnorderedList'))}
        {btn('Numbered list', '1. List', () => cmd('insertOrderedList'))}
        <span className="rd-sep" />
        {btn('Insert link', 'Link', () => { remember(); setMsg(''); setPanel(panel === 'link' ? '' : 'link'); }, panel === 'link' ? 'rd-on' : '')}
        {btn('Insert image', 'Image', () => { remember(); setMsg(''); setPanel(panel === 'image' ? '' : 'image'); }, panel === 'image' ? 'rd-on' : '')}
        <span className="rd-sep" />
        {btn('Remove formatting', 'Clear', () => cmd('removeFormat'))}
        {btn('Undo', '↶', () => cmd('undo'))}
        {btn('Redo', '↷', () => cmd('redo'))}
      </div>
      {panel === 'link' && (
        <form className="rd-panel" onSubmit={(e) => { e.preventDefault(); addLink(); }}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (select text first to link it)" aria-label="Link address" />
          <button type="submit" className="rd-ok">Add link</button>
          <button type="button" className="rd-cancel" onClick={() => setPanel('')}>Cancel</button>
        </form>
      )}
      {panel === 'image' && (
        <form className="rd-panel" onSubmit={(e) => { e.preventDefault(); insertImage(url); }}>
          <button type="button" className="rd-ok" onClick={() => fileInput.current?.click()}>From my computer…</button>
          <span className="rd-or">or</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… address of an image" aria-label="Image address" />
          <button type="submit" className="rd-ok" disabled={!url.trim()}>Add</button>
          <button type="button" className="rd-cancel" onClick={() => setPanel('')}>Cancel</button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addFile(f); }} />
        </form>
      )}
      {msg && <p className="rd-msg" role="alert">{msg}</p>}
      <div
        ref={ref}
        className="doc-paper"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        spellCheck
        onInput={changed}
        onBlur={() => { remember(); flush(); }}
        onKeyUp={remember}
        onMouseUp={remember}
        onPaste={onPaste}
        onDrop={onDrop}
        onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a) e.preventDefault(); }}
      />
    </div>
  );
}

/** A read-only view of a stored document, same paper look. */
export function PaperView({ html }: { html: string }) {
  return <div className="doc-paper" dangerouslySetInnerHTML={{ __html: html }} />;
}
