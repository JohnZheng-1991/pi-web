import { encodeFilePathForApi } from "./file-paths";

/** True when the file was downloaded; false when it is safe to preview as text. */
export async function downloadBinaryFile(filePath: string): Promise<boolean> {
  const url = `/api/files/${encodeFilePathForApi(filePath)}`;
  const response = await fetch(`${url}?type=meta`);
  // The preview reports an inaccessible or missing file as before.
  if (!response.ok) return false;
  const { mime } = (await response.json()) as { mime: string };
  if (mime !== "application/octet-stream") return false;
  const link = document.createElement("a");
  link.href = `${url}?type=download`;
  link.download = filePath.split(/[\\/]/).pop() ?? "download";
  link.click();
  return true;
}
