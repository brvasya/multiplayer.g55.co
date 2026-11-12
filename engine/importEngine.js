// Every game resolves shared dependencies from this engine, never from its own folder.
export function importEngine(moduleName) {
  return import(new URL(moduleName, import.meta.url).href);
}
