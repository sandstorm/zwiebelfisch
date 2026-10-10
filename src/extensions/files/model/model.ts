// The files extension's model: the file tree as data (tree-model.ts) and uploads as project changes (upload.ts).
// Pure: no DOM, no editor library. Entry of extensions/files/model/. See ../files.ts.
export { ancestorsOf, buildTree, filesUnder, type Folder, folderOf, navigate, relocate, type Row, visibleRows } from './tree-model';
export { uploadChanges } from './upload';
