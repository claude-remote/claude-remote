import { CwdPicker } from '@/web/components/CwdPicker';
import { FileViewer } from '@/web/components/FileViewer';
import { useCallback, useEffect, useMemo, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

interface TreeNode extends FileEntry {
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
}

interface Favorite {
  id: string;
  label: string;
  path: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSessionIdFromPath(): string {
  const parts = globalThis.location?.pathname?.split('/') ?? [];
  return parts[2] || '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pathSegments(path: string): string[] {
  return path.replace(/\/+$/, '').split('/').filter(Boolean);
}

function buildBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const segs = pathSegments(path);
  const crumbs: Array<{ label: string; path: string }> = [];
  let accumulated = '';
  for (const seg of segs) {
    accumulated += `/${seg}`;
    crumbs.push({ label: seg, path: accumulated });
  }
  if (crumbs.length === 0) {
    crumbs.push({ label: '/', path: '/' });
  }
  return crumbs;
}

const LINES_PER_PAGE = 500;

/* ------------------------------------------------------------------ */
/*  API helpers (fetch wrappers)                                       */
/* ------------------------------------------------------------------ */

async function fetchDirListing(dirPath: string): Promise<FileEntry[]> {
  const res = await fetch(`/api/files/list?path=${encodeURIComponent(dirPath)}`);
  if (!res.ok) throw new Error(`Failed to list ${dirPath}`);
  const data = await res.json();
  return (data.entries ?? data ?? []) as FileEntry[];
}

async function fetchFileContent(
  filePath: string,
  offset = 0,
  limit = LINES_PER_PAGE,
): Promise<{ content: string; totalLines: number; size: number; modified: string }> {
  const params = new URLSearchParams({
    path: filePath,
    offset: String(offset),
    limit: String(limit),
  });
  const res = await fetch(`/api/files/read?${params}`);
  if (!res.ok) throw new Error(`Failed to read ${filePath}`);
  return res.json();
}

async function fetchBrowseDirs(partial: string): Promise<string[]> {
  const res = await fetch(`/api/files/browse?path=${encodeURIComponent(partial)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dirs ?? data ?? []) as string[];
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Breadcrumb bar */
function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const crumbs = useMemo(() => buildBreadcrumbs(path), [path]);
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <span key={crumb.path} className="flex items-center gap-1 shrink-0">
          {i > 0 && <span className="text-gray-600">/</span>}
          <button
            onClick={() => onNavigate(crumb.path)}
            className="text-gray-400 hover:text-gray-200 transition-colors truncate max-w-[160px]"
            title={crumb.path}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** Single tree row */
function TreeRow({
  node,
  depth,
  selected,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: boolean;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
}) {
  const isDir = node.type === 'directory';
  const icon = isDir ? (node.expanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1') : '\uD83D\uDCC4';

  return (
    <button
      onClick={() => (isDir ? onToggle(node) : onSelect(node))}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
        selected
          ? 'bg-gray-800 text-gray-100'
          : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      title={node.path}
    >
      <span className="shrink-0 text-xs">{icon}</span>
      <span className="truncate">{node.name}</span>
      {node.loading && <span className="ml-auto text-xs text-gray-600 animate-pulse">...</span>}
    </button>
  );
}

/** Recursive tree renderer */
function TreeBranch({
  nodes,
  depth,
  selectedPath,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string | null;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.path}>
          <TreeRow
            node={node}
            depth={depth}
            selected={node.path === selectedPath}
            onToggle={onToggle}
            onSelect={onSelect}
          />
          {node.expanded && node.children && (
            <TreeBranch
              nodes={node.children}
              depth={depth + 1}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export function Files() {
  const sessionId = useMemo(() => getSessionIdFromPath(), []);

  // State
  const [cwd, setCwd] = useState('~/');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileTotalLines, setFileTotalLines] = useState(0);
  const [fileSize, setFileSize] = useState('');
  const [fileModified, setFileModified] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [mobileView, setMobileView] = useState<'tree' | 'viewer'>('tree');
  const [error, setError] = useState<string | null>(null);

  // Load root directory
  const loadDirectory = useCallback(
    async (dirPath: string, parentNodes?: TreeNode[]): Promise<TreeNode[]> => {
      try {
        const entries = await fetchDirListing(dirPath);
        // Sort: directories first, then alphabetical
        const sorted = entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return sorted.map((entry) => ({
          ...entry,
          expanded: false,
          children: entry.type === 'directory' ? undefined : undefined,
        }));
      } catch (err) {
        setError(`Failed to load directory: ${dirPath}`);
        return parentNodes ?? [];
      }
    },
    [],
  );

  // Load initial tree on mount or CWD change
  useEffect(() => {
    setError(null);
    loadDirectory(cwd).then((nodes) => {
      setTree(nodes);
      setSelectedFile(null);
      setFileContent('');
    });
  }, [cwd, loadDirectory]);

  // Toggle directory expansion
  const handleToggleDir = useCallback(
    async (target: TreeNode) => {
      // Helper to toggle within a nested tree
      const toggleInTree = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        const result: TreeNode[] = [];
        for (const node of nodes) {
          if (node.path === target.path) {
            if (node.expanded) {
              // Collapse
              result.push({ ...node, expanded: false });
            } else {
              // Expand: load children if not yet loaded
              if (!node.children) {
                const updated = { ...node, loading: true, expanded: true };
                result.push(updated);
                // We'll update with real children after
              } else {
                result.push({ ...node, expanded: true });
              }
            }
          } else if (node.children && node.expanded) {
            result.push({ ...node, children: await toggleInTree(node.children) });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      // First pass: toggle expanded state
      const newTree = await toggleInTree(tree);
      setTree(newTree);

      // If we need to fetch children
      if (!target.expanded && !target.children) {
        try {
          const children = await loadDirectory(target.path);
          // Update the node with fetched children
          const injectChildren = (nodes: TreeNode[]): TreeNode[] =>
            nodes.map((node) => {
              if (node.path === target.path) {
                return { ...node, children, loading: false };
              }
              if (node.children && node.expanded) {
                return { ...node, children: injectChildren(node.children) };
              }
              return node;
            });
          setTree((prev) => injectChildren(prev));
        } catch {
          setError(`Failed to expand: ${target.path}`);
        }
      }
    },
    [tree, loadDirectory],
  );

  // Select a file
  const handleSelectFile = useCallback(async (node: TreeNode) => {
    setSelectedFile(node.path);
    setLoadingFile(true);
    setError(null);
    setMobileView('viewer');

    try {
      const data = await fetchFileContent(node.path, 0, LINES_PER_PAGE);
      setFileContent(data.content);
      setFileTotalLines(data.totalLines);
      setFileSize(formatBytes(data.size));
      setFileModified(data.modified);
    } catch {
      setFileContent('');
      setError(`Failed to read file: ${node.path}`);
    } finally {
      setLoadingFile(false);
    }
  }, []);

  // Load more lines for current file
  const handleLoadMore = useCallback(
    async (offset: number) => {
      if (!selectedFile) return;
      setLoadingMore(true);
      try {
        const data = await fetchFileContent(selectedFile, offset, LINES_PER_PAGE);
        setFileContent((prev) => `${prev}\n${data.content}`);
      } catch {
        setError('Failed to load more lines');
      } finally {
        setLoadingMore(false);
      }
    },
    [selectedFile],
  );

  // Navigate via breadcrumb
  const handleBreadcrumbNav = useCallback((path: string) => {
    setCwd(path);
  }, []);

  // CWD picker handlers
  const handleChangeCwd = useCallback((path: string) => {
    setCwd(path);
  }, []);

  const handleAddFavorite = useCallback((path: string, label?: string) => {
    const newFav: Favorite = {
      id: `fav-${Date.now()}`,
      label: label || path.split('/').filter(Boolean).pop() || path,
      path,
    };
    setFavorites((prev) => {
      if (prev.some((f) => f.path === path)) return prev;
      return [...prev, newFav];
    });
  }, []);

  const handleBrowse = useCallback(async (partial: string) => {
    return fetchBrowseDirs(partial);
  }, []);

  return (
    <main className="flex h-[100dvh] flex-col bg-gray-950">
      {/* Header */}
      <header className="shrink-0 space-y-2 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-100">Files</h1>
          {/* Mobile toggle */}
          <div className="flex gap-1 md:hidden">
            <button
              onClick={() => setMobileView('tree')}
              className={`rounded px-2 py-1 text-xs ${
                mobileView === 'tree'
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Tree
            </button>
            <button
              onClick={() => setMobileView('viewer')}
              className={`rounded px-2 py-1 text-xs ${
                mobileView === 'viewer'
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Viewer
            </button>
          </div>
        </div>

        <CwdPicker
          cwd={cwd}
          favorites={favorites}
          session={{ id: sessionId }}
          onChangeCwd={handleChangeCwd}
          onAddFavorite={handleAddFavorite}
          onBrowse={handleBrowse}
        />

        <Breadcrumbs path={cwd} onNavigate={handleBreadcrumbNav} />
      </header>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 border-b border-red-900/50 bg-red-950/30 px-4 py-2 text-xs text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-300">
            Dismiss
          </button>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex min-h-0 flex-1">
        {/* Tree sidebar */}
        <aside
          className={`shrink-0 overflow-y-auto border-r border-gray-800 bg-gray-950 ${
            mobileView === 'tree' ? 'block' : 'hidden'
          } md:block md:w-64 lg:w-72 w-full`}
        >
          <div className="p-2">
            {tree.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-gray-600">No files found</p>
            ) : (
              <TreeBranch
                nodes={tree}
                depth={0}
                selectedPath={selectedFile}
                onToggle={handleToggleDir}
                onSelect={handleSelectFile}
              />
            )}
          </div>
        </aside>

        {/* File viewer panel */}
        <div
          className={`min-w-0 flex-1 overflow-auto p-4 ${
            mobileView === 'viewer' ? 'block' : 'hidden'
          } md:block`}
        >
          {selectedFile ? (
            <FileViewer
              path={selectedFile}
              content={fileContent}
              totalLines={fileTotalLines}
              fileSize={fileSize}
              lastModified={fileModified}
              onLoadMore={handleLoadMore}
              loading={loadingFile || loadingMore}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-600">
              Select a file from the tree to view its contents
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
