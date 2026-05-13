// src/lib/pdfExport.js
// Pixel-perfect PDF export of a DOM element via html2canvas -> jsPDF.
//
// Both deps are heavyweight (~500 KB combined) so this module is intended to
// be lazy-imported by callers (import('./pdfExport.js')) on click. Do NOT
// import statically from pages that load on first paint.

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// Captures an element and returns a multi-page A4 PDF. Long pages are sliced
// across pages so nothing gets cropped.
//
// Options:
//   filename:        download filename
//   backgroundColor: canvas background fill (matches the on-screen bg)
//   scale:           render scale (2 = retina; 3 = sharper but slower)
//   orientation:     'portrait' | 'landscape'
//   hideSelector:    CSS selector for elements to TEMPORARILY hide during capture
export async function exportElementToPdf(el, {
  filename = 'export.pdf',
  backgroundColor = '#050816',
  scale = 2,
  orientation = 'portrait',
  hideSelector = null,
} = {}) {
  if (!el) throw new Error('exportElementToPdf: target element is required');

  // Optionally hide a set of nodes (e.g. action buttons, filter bar) for the
  // capture window only.
  const hidden = [];
  if (hideSelector) {
    document.querySelectorAll(hideSelector).forEach((node) => {
      hidden.push({ node, original: node.style.visibility });
      node.style.visibility = 'hidden';
    });
  }

  let canvas;
  try {
    canvas = await html2canvas(el, {
      backgroundColor,
      scale,
      useCORS: true,
      logging: false,
      windowWidth: el.scrollWidth,
    });
  } finally {
    hidden.forEach(({ node, original }) => { node.style.visibility = original || ''; });
  }

  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Map canvas pixels to PDF points, preserving the canvas's aspect ratio.
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // If the content fits on one page, drop it in and we're done.
  if (imgHeight <= pageHeight) {
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
  } else {
    // Multi-page: slice the source canvas into page-height chunks.
    const pxPerPoint = canvas.width / pageWidth;
    const sliceHeightPx = Math.floor(pageHeight * pxPerPoint);
    let yPx = 0;
    let pageIdx = 0;
    while (yPx < canvas.height) {
      const thisSlicePx = Math.min(sliceHeightPx, canvas.height - yPx);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = thisSlicePx;
      const ctx = sliceCanvas.getContext('2d');
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, yPx, canvas.width, thisSlicePx, 0, 0, canvas.width, thisSlicePx);
      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
      const sliceImgHeight = (thisSlicePx * imgWidth) / canvas.width;
      if (pageIdx > 0) pdf.addPage();
      pdf.addImage(sliceData, 'JPEG', 0, 0, imgWidth, sliceImgHeight);
      yPx += thisSlicePx;
      pageIdx += 1;
    }
  }

  pdf.save(filename);
}
