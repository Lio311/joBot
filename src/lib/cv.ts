import { extractText, getDocumentProxy } from "unpdf";

/** Plain text of a PDF CV (text-based PDFs; scanned images come back nearly empty). */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 30_000);
}
