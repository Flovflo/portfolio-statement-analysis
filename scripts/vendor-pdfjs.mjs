import { copyFile, mkdir } from 'node:fs/promises';

const outputDir = 'vendor/pdfjs';

await mkdir(outputDir, { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.min.mjs', `${outputDir}/pdf.min.mjs`);
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${outputDir}/pdf.worker.min.mjs`);

console.log(`Vendored PDF.js files into ${outputDir}`);
