export async function extractLinesFromPdfData(pdfData, pdfjs, options = {}) {
  const loadingTask = pdfjs.getDocument({
    data: pdfData,
    disableWorker: options.disableWorker ?? typeof window === 'undefined',
    verbosity: options.verbosity ?? 0,
  });
  const document = await loadingTask.promise;
  const lines = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);
    const content = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: false,
    });

    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;

      lines.push({
        page: pageIndex,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
        text: item.str.trim(),
      });
    }

    if (typeof page.cleanup === 'function') page.cleanup();
    if (typeof options.onProgress === 'function') options.onProgress(pageIndex, document.numPages);
  }

  if (typeof document.destroy === 'function') await document.destroy();
  return lines;
}
