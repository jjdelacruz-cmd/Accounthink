"use client";

/** Builds an .xlsx from sheet data in the browser and saves it. */
export async function downloadXlsx(sheets: unknown, fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await writeXlsxFile(sheets as any).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
