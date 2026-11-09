export interface Bundle {
  root: string;
  entry: string;
  name: string;
}

export interface Course extends Bundle {
  title: string;
  text: string;
  mtime: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Vault paths, never system paths. Do not allow an entry to escape its folder. */
export function cleanPath(value: string): string | null {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return null;
  return parts.join("/");
}

export function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root + "/");
}

export function discoverBundles(
  filePaths: readonly string[],
  ignoredFolders: readonly string[] = [],
): Bundle[] {
  const ignored = ignoredFolders.map(cleanPath).filter((p): p is string => p !== null);
  const candidates = new Map<string, Bundle>();
  for (const original of filePaths) {
    const path = cleanPath(original);
    if (!path) continue;
    const parts = path.split("/");
    const file = parts.pop()!;
    if (!parts.length || !/^index\.html?$/i.test(file)) continue;
    if (parts.some((p) => p.startsWith(".") || p === "node_modules")) continue;
    const root = parts.join("/");
    if (ignored.some((p) => isWithin(root, p))) continue;
    const existing = candidates.get(root);
    // Prefer index.html over index.htm when both exist, independent of input order.
    if (!existing || (file.toLowerCase() === "index.html" && !existing.entry.toLowerCase().endsWith("index.html"))) {
      candidates.set(root, { root, entry: path, name: parts[parts.length - 1] });
    }
  }
  const sorted = [...candidates.values()].sort(
    (a, b) => a.root.split("/").length - b.root.split("/").length || a.root.localeCompare(b.root),
  );
  const roots: Bundle[] = [];
  for (const candidate of sorted) {
    if (!roots.some((parent) => isWithin(candidate.root, parent.root))) roots.push(candidate);
  }
  return roots.sort((a, b) => a.root.localeCompare(b.root));
}

export function findBundle(path: string, bundles: Iterable<Bundle>): Bundle | undefined {
  for (const bundle of bundles) if (isWithin(path, bundle.root)) return bundle;
}

export function movePath(path: string, oldPath: string, newPath: string): string {
  return isWithin(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
}

export function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function searchCourses(courses: readonly Course[], query: string): { course: Course; snippet: string }[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return courses.flatMap((course) => {
    const haystack = `${course.name}\n${course.title}\n${course.root}\n${course.text}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return [];
    const hit = terms.length ? course.text.toLocaleLowerCase().indexOf(terms[0]) : -1;
    const start = Math.max(0, hit - 35);
    return [{ course, snippet: (start ? "…" : "") + course.text.slice(start, start + 130) + (course.text.length > start + 130 ? "…" : "") }];
  });
}
