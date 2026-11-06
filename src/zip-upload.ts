import { zip } from "fflate";

const MAX_ZIP_BYTES = 10 * 1024 * 1024;

/** Compresses one or more files into a single .zip File ready for upload. */
export async function zipFiles(files: File[]): Promise<File> {
  if (!files.length) throw new Error("Choose at least one file.");
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    let name = file.name || "file";
    for (let n = 2; name in entries; n++) name = file.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    entries[name] = new Uint8Array(await file.arrayBuffer());
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, { level: 9 }, (error, data) => (error ? reject(error) : resolve(data))));
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error("These files are too large even after zipping (10 MB limit).");
  const base = files.length === 1 ? files[0].name.replace(/\.[^.]*$/, "") || "file" : `documents-${new Date().toISOString().slice(0, 10)}`;
  return new File([bytes as BlobPart], `${base}.zip`, { type: "application/zip" });
}
