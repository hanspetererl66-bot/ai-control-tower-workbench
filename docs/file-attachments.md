# Chat file attachments

Werkbank's chat `+` button is a live attachment flow. It opens the native file picker, copies the selected files into `workspace/attachments/`, shows removable context cards in the composer, and sends structured ACP content blocks to Goose.

## Supported first wave

- PowerPoint: `.pptx`, `.ppt`
- Word: `.docx`, `.doc`
- Text and structured text: `.txt`, `.md`, `.csv`, `.json`
- Pictures: `.png`, `.jpg`, `.jpeg`, `.webp`

Modern Word and PowerPoint files are parsed from their OOXML parts, including PowerPoint speaker notes and Word headers, footers, footnotes, and endnotes. Legacy Word uses macOS `textutil`; legacy PowerPoint uses LibreOffice when available. Pictures are sent as real ACP image blocks and also receive local OCR fallback text through Tesseract.

Every attachment is also sent as an ACP resource link pointing at its stable workspace copy. Extracted Office/text content is sent as an embedded resource when the agent advertises embedded-context support.

If a configured provider rejects image input, Werkbank retries the turn without pixel data and supplies the resource path plus OCR text instead of failing the whole prompt. For full visual understanding, use the vision-capable default from `.env.example`.

## Safety and privacy

- At most 8 files per selection.
- At most 20 MB per file and 50 MB per selection.
- Executables and unlisted formats are rejected before copying.
- Extracted text is capped at 120,000 characters per file.
- `workspace/attachments/` is gitignored because selected files may be private.

## Verification

Run the parser and copy-path checks with:

```bash
npm test
```

The automated suite creates real zipped DOCX/PPTX fixtures, checks Office extraction and slide order, verifies image bytes and text context, and rejects unsupported files.
