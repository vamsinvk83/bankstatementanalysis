#!/usr/bin/env node
// Offline fallback for scanned/image-only bank statement PDFs that the browser
// tool's in-browser OCR can't reliably read (a Tesseract.js/WASM limitation on
// GitHub Pages, not a problem with the statement itself). This does the exact
// same conversion natively: rasterize every page, OCR it, reconstruct
// transactions with the same block-grouping logic the web tool uses, then
// write a CSV you can drag straight into bank-statement-analyzer.html.
//
// Requirements (install once):
//   - Poppler (for pdftoppm): https://github.com/oschwartz10612/poppler-windows/releases
//   - Tesseract OCR:          https://github.com/UB-Mannheim/tesseract/wiki
//   Both need to be on your PATH (or edit POPPLER_BIN / TESSERACT_BIN below).
//
// Usage:
//   node pdf-to-csv.mjs "statement.pdf" [output.csv]

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// Leave these blank to use whatever's on PATH, or set an absolute path if a
// tool isn't installed system-wide (e.g. 'C:\\poppler\\Library\\bin\\pdftoppm.exe').
const PDFTOPPM_BIN = 'pdftoppm';
const TESSERACT_BIN = 'tesseract';

function fail(msg){
  console.error('\nERROR: ' + msg + '\n');
  process.exit(1);
}

async function checkTool(bin, name, installUrl){
  try{
    await execFileAsync(bin, ['-v'], { windowsHide: true });
  }catch(e){
    if(e.code === 'ENOENT'){
      fail(`${name} not found on PATH ("${bin}"). Install it from:\n  ${installUrl}\nthen make sure it's on your PATH (or edit the *_BIN constant at the top of this script), and try again.`);
    }
    // pdftoppm -v exits non-zero but still prints version info to stderr — that's fine, ignore.
  }
}

// ---- Same parsing logic as the web tool (kept in sync intentionally) ----
function num(v){
  if(v===undefined||v===null) return 0;
  const s = String(v).replace(/[^0-9.\-]/g,'');
  const f = parseFloat(s);
  return isNaN(f) ? 0 : f;
}
function looksLikeBlockStart(line){
  const m = line.match(/^\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s*(.*)$/);
  return !!(m && /[A-Za-z]/.test(m[1]));
}
const NOISE_RE = /^\s*(page\s*no|statement of account|hdfc bank|closing balance includes|contents of this statement|nomination|state account branch|registered office|account branch|account no|account status|rtgs\/neft|branch code|account type|joint holders|date narration|generated on)/i;
function groupLinesIntoBlocks(lines){
  const blocks = [];
  let current = null;
  lines.forEach(line => {
    const clean = line.replace(/\s+/g,' ').trim();
    if(!clean || NOISE_RE.test(clean)) return;
    if(looksLikeBlockStart(clean)){
      current = [clean];
      blocks.push(current);
    } else if(current){
      current.push(clean);
    }
  });
  return blocks;
}
function parseStatementLine(line, lastBalance){
  const dateMatch = line.match(/^\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
  if(!dateMatch) return null;
  const date = dateMatch[1];
  const rest = line.slice(dateMatch[0].length).trim();
  const numRe = /[\d,]+\.\d{1,2}/g;
  const nums = rest.match(numRe);
  if(!nums || nums.length===0) return null;
  const firstNumIdx = rest.search(numRe);
  const description = rest.slice(0, firstNumIdx).trim().replace(/\s{2,}/g,' ');
  const values = nums.map(n => parseFloat(n.replace(/,/g,'')));
  let amount, balance = null;
  if(values.length >= 2){ balance = values[values.length-1]; amount = values[values.length-2]; }
  else { amount = values[0]; }
  const upper = rest.toUpperCase();
  let type = null;
  if(/\bCR\b|\bCREDIT\b/.test(upper)) type = 'credit';
  else if(/\bDR\b|\bDEBIT\b/.test(upper)) type = 'debit';
  else if(balance !== null && lastBalance !== null) type = balance >= lastBalance ? 'credit' : 'debit';
  let debit = 0, credit = 0, uncertain = false;
  if(type === 'credit') credit = amount;
  else if(type === 'debit') debit = amount;
  else { debit = amount; uncertain = true; }
  return {date, description: description || '(no description found)', debit, credit, balance, uncertain};
}
function cleanDesc(s){
  return s.replace(/^[|.\s]+/,'').replace(/\s*\|\s*/g,' ').replace(/\s+/g,' ').trim();
}

async function main(){
  const pdfPath = process.argv[2];
  if(!pdfPath){
    fail('Usage: node pdf-to-csv.mjs "statement.pdf" [output.csv]');
  }
  if(!fs.existsSync(pdfPath)){
    fail(`File not found: ${pdfPath}`);
  }
  const outCsv = process.argv[3] || pdfPath.replace(/\.pdf$/i, '') + '_transactions.csv';

  await checkTool(PDFTOPPM_BIN, 'Poppler (pdftoppm)', 'https://github.com/oschwartz10612/poppler-windows/releases');
  await checkTool(TESSERACT_BIN, 'Tesseract OCR', 'https://github.com/UB-Mannheim/tesseract/wiki');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2csv-'));
  const pagesDir = path.join(workDir, 'pages');
  const ocrDir = path.join(workDir, 'ocr');
  fs.mkdirSync(pagesDir);
  fs.mkdirSync(ocrDir);

  console.log('Rasterizing PDF pages...');
  await execFileAsync(PDFTOPPM_BIN, ['-png', '-r', '200', pdfPath, path.join(pagesDir, 'pg')], { windowsHide: true });

  const pageFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.png')).sort();
  if(pageFiles.length === 0){
    fail('pdftoppm produced no page images — is the PDF valid/not password-protected?');
  }
  console.log(`Rendered ${pageFiles.length} page(s). Running OCR (this can take a while for long statements)...`);

  for(let i=0;i<pageFiles.length;i++){
    const f = pageFiles[i];
    process.stdout.write(`  OCR page ${i+1}/${pageFiles.length}...\r`);
    const base = f.replace(/\.png$/, '');
    await execFileAsync(TESSERACT_BIN, [path.join(pagesDir, f), path.join(ocrDir, base), '--psm', '6'], { windowsHide: true });
  }
  console.log('\nOCR complete. Parsing transactions...');

  const ocrFiles = fs.readdirSync(ocrDir).filter(f => f.endsWith('.txt')).sort();
  let lastBalance = null;
  const rows = [['Date','Description','Debit','Credit','Balance']];
  let uncertainCount = 0;

  ocrFiles.forEach(f => {
    const text = fs.readFileSync(path.join(ocrDir, f), 'utf8');
    const lines = text.split(/\r?\n/);
    groupLinesIntoBlocks(lines).forEach(blockLines => {
      const parsed = parseStatementLine(blockLines[0], lastBalance);
      if(parsed){
        if(parsed.balance != null) lastBalance = parsed.balance;
        if(parsed.uncertain) uncertainCount++;
        const fullDesc = cleanDesc([parsed.description, ...blockLines.slice(1)].join(' '));
        rows.push([parsed.date, fullDesc, parsed.debit||'', parsed.credit||'', parsed.balance!=null?parsed.balance:'']);
      }
    });
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  fs.writeFileSync(outCsv, csv);

  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(`\nDone: extracted ${rows.length-1} transaction(s), ${uncertainCount} flagged uncertain (debit/credit direction unconfirmed).`);
  console.log(`Wrote: ${outCsv}`);
  console.log('Upload this CSV into bank-statement-analyzer.html — spot-check it, especially any uncertain rows.');
}

main().catch(e => fail(e.message));
