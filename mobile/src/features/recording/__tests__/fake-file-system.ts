/** In-memory stand-in for the expo-file-system File/Directory API used by the storage modules. */
export function createFakeFileSystem() {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const failures = { read: false };

  const join = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/").replace(/\/+/g, "/").replace("file:/", "file:///");
  const parent = (uri: string) => uri.replace(/\/[^/]+$/, "");

  class Directory {
    uri: string;
    constructor(...uris: (string | { uri: string })[]) { this.uri = join(uris); }
    get exists() { return directories.has(this.uri); }
    get parentDirectory() { return new Directory(parent(this.uri)); }
    create() { directories.add(this.uri); }
    delete() { directories.delete(this.uri); }
  }

  class File {
    uri: string;
    constructor(...uris: (string | { uri: string })[]) { this.uri = join(uris); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    get name() { return this.uri.slice(this.uri.lastIndexOf("/") + 1); }
    get parentDirectory() { return new Directory(parent(this.uri)); }
    create() { files.set(this.uri, ""); }
    write(content: string) { files.set(this.uri, content); }
    textSync() {
      if (failures.read) throw new Error("read failure");
      const content = files.get(this.uri);
      if (content === undefined) throw new Error(`missing ${this.uri}`);
      return content;
    }
    copy(destination: File | Directory) {
      const target = destination instanceof Directory ? join([destination.uri, this.name]) : destination.uri;
      files.set(target, this.textSync());
    }
    delete() { files.delete(this.uri); }
  }

  const Paths = { document: new Directory("file:///documents"), cache: new Directory("file:///cache") };
  const reset = () => { files.clear(); directories.clear(); failures.read = false; };

  return { Directory, File, Paths, files, directories, failures, reset };
}
