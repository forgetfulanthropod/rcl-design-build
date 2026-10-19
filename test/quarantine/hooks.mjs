const SHIM = new URL("./shim.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if ((specifier === "node:test" || specifier === "test") && context.parentURL !== SHIM) {
    return { url: SHIM, shortCircuit: true };
  }
  return next(specifier, context);
}
