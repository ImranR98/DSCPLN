import path from "node:path";
import { classifyDestMatch, statSize } from "../verify.js";

export async function classifyExistingDest(store, folder, destPath, sourceSize, method) {
  const destName = path.basename(destPath);
  const destSize = await statSize(destPath);
  store.invalidateDest(folder.def.name);
  if (destSize === null) {
    return { status: "error", kind: "verify", message: "destination changed during placement; will retry" };
  }
  const verdict = classifyDestMatch({ method, sourceSize, destSize });
  if (verdict === "conflict") {
    return {
      status: "conflict",
      destName,
      message: `destination ${destName} already exists with a very different size — review`,
    };
  }
  return { status: "duplicate", destName, message: "destination already contained this file" };
}
