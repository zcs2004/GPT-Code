import { stdin } from "node:process";

const MAX_RUNTIME_KEY_STDIN_BYTES = 64 * 1024;

export async function readRuntimeKeyFromStdin(
  input: AsyncIterable<Uint8Array | string> = stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_RUNTIME_KEY_STDIN_BYTES) {
      throw new Error("Runtime key stdin is empty or unexpectedly large");
    }
    chunks.push(buffer);
  }
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (!value) throw new Error("Runtime key stdin is empty or unexpectedly large");
  return value;
}
