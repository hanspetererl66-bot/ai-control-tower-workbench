import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  extractDocxText,
  extractPptxText,
  prepareAttachments,
  xmlToText,
} from '../electron/attachments.mjs';

function zippedFixture(root, filename, entries) {
  const source = join(root, `${filename}-source`);
  mkdirSync(source, { recursive: true });
  for (const [path, contents] of Object.entries(entries)) {
    const target = join(source, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }
  const output = join(root, filename);
  execFileSync('/usr/bin/zip', ['-qr', output, '.'], { cwd: source });
  return output;
}

function fixtures() {
  const root = mkdtempSync(join(tmpdir(), 'werkbank-attachments-test-'));
  const docx = zippedFixture(root, 'brief.docx', {
    'word/document.xml':
      '<w:document><w:body><w:p><w:r><w:t>Customer brief</w:t></w:r></w:p><w:p><w:r><w:t>Target: 20 percent</w:t></w:r></w:p></w:body></w:document>',
  });
  const pptx = zippedFixture(root, 'deck.pptx', {
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Executive summary</a:t></a:r></a:p></p:sld>',
    'ppt/notesSlides/notesSlide1.xml':
      '<p:notes><a:p><a:r><a:t>Explain the trend</a:t></a:r></a:p></p:notes>',
  });
  const text = join(root, 'notes.txt');
  writeFileSync(text, 'Actual text context', 'utf8');
  const image = join(root, 'chart.png');
  writeFileSync(
    image,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  );
  return { root, docx, pptx, text, image };
}

test('OOXML extraction preserves Word paragraphs and PowerPoint slide order', () => {
  const sample = fixtures();
  try {
    assert.equal(extractDocxText(sample.docx), 'Customer brief\nTarget: 20 percent');
    const deck = extractPptxText(sample.pptx);
    assert.match(deck, /--- Slide 1 ---\nExecutive summary/);
    assert.match(deck, /Speaker notes:\nExplain the trend/);
    assert.ok(deck.indexOf('Executive summary') < deck.indexOf('Second slide'));
  } finally {
    rmSync(sample.root, { recursive: true, force: true });
  }
});

test('selected files are copied into the workspace with real prompt context', () => {
  const sample = fixtures();
  const workspace = join(sample.root, 'workspace');
  try {
    const result = prepareAttachments(
      [sample.pptx, sample.docx, sample.text, sample.image],
      workspace
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.files.length, 4);
    assert.ok(result.files.every((file) => file.path.startsWith(join(workspace, 'attachments'))));
    assert.match(result.files.find((file) => file.name === 'deck.pptx').extractedText, /Executive summary/);
    assert.match(result.files.find((file) => file.name === 'brief.docx').extractedText, /Customer brief/);
    assert.equal(result.files.find((file) => file.name === 'notes.txt').extractedText, 'Actual text context');
    assert.equal(
      Buffer.from(result.files.find((file) => file.name === 'chart.png').imageData, 'base64').compare(
        readFileSync(sample.image)
      ),
      0
    );
  } finally {
    rmSync(sample.root, { recursive: true, force: true });
  }
});

test('unsafe and unsupported selections are rejected before copying', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkbank-attachments-reject-'));
  try {
    const executable = join(root, 'payload.sh');
    writeFileSync(executable, '#!/bin/sh\necho no', 'utf8');
    assert.throws(
      () => prepareAttachments([executable], join(root, 'workspace')),
      /not a supported file type/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('XML extraction decodes entities and explicit line breaks', () => {
  assert.equal(
    xmlToText('<w:p><w:t>R&amp;D</w:t><w:br/><w:t>Q&#x33;</w:t></w:p>'),
    'R&D\nQ3'
  );
});
