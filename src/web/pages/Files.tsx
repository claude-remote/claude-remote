import { FileViewer } from '@/web/components/FileViewer';
import { CwdPicker } from '@/web/components/CwdPicker';

export function Files() {
  // TODO(T17): implement cwd browsing, favorites, and paginated file preview.
  return (
    <main className="space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Files</h1>
      <CwdPicker cwd="~/" favorites={[]} />
      <FileViewer path="README.md" content="// file preview" />
    </main>
  );
}
