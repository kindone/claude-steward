import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import { listFiles, getFileContent } from '../lib/api';
export function FileTree({ projectId }) {
    const [expanded, setExpanded] = useState(false);
    const [tree, setTree] = useState(new Map());
    const [openDirs, setOpenDirs] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [viewer, setViewer] = useState(null);
    const loadDir = useCallback(async (dirPath) => {
        if (tree.has(dirPath))
            return;
        setLoading(true);
        try {
            const entries = await listFiles(projectId, dirPath);
            setTree((prev) => new Map(prev).set(dirPath, entries));
        }
        catch (err) {
            console.error('[FileTree] load error', err);
        }
        finally {
            setLoading(false);
        }
    }, [projectId, tree]);
    useEffect(() => {
        if (expanded && !tree.has('')) {
            void loadDir('');
        }
    }, [expanded, loadDir, tree]);
    async function toggleDir(path) {
        if (openDirs.has(path)) {
            setOpenDirs((prev) => { const s = new Set(prev); s.delete(path); return s; });
        }
        else {
            setOpenDirs((prev) => new Set(prev).add(path));
            await loadDir(path);
        }
    }
    async function openFile(path) {
        try {
            const content = await getFileContent(projectId, path);
            setViewer({ path, content });
        }
        catch (err) {
            alert(err.message);
        }
    }
    function renderEntries(entries, depth) {
        return entries.map((entry) => (_jsx("div", { style: { paddingLeft: depth * 12 }, children: entry.type === 'directory' ? (_jsxs(_Fragment, { children: [_jsxs("button", { className: "flex items-center gap-1 w-full bg-transparent border-none text-[#7aa2d4] hover:text-[#93bbf0] font-medium text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-[#1a1a1a] transition-colors min-h-[36px]", onClick: () => void toggleDir(entry.path), children: [_jsx("span", { children: openDirs.has(entry.path) ? '▾' : '▸' }), _jsxs("span", { children: [entry.name, "/"] })] }), openDirs.has(entry.path) && tree.has(entry.path) &&
                        renderEntries(tree.get(entry.path), depth + 1)] })) : (_jsxs("button", { className: "flex items-center gap-1 w-full bg-transparent border-none text-[#888] hover:text-[#ccc] text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-[#1a1a1a] transition-colors font-[inherit] min-h-[36px]", onClick: () => void openFile(entry.path), children: [_jsx("span", { className: "text-[#444] flex-shrink-0", children: "\u00B7" }), _jsx("span", { className: "truncate", children: entry.name })] })) }, entry.path)));
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "border-t border-[#1f1f1f] flex-shrink-0", children: [_jsxs("button", { className: "w-full flex items-center gap-1.5 px-3 py-2 bg-transparent border-none text-[#555] hover:text-[#888] text-[11px] font-semibold tracking-widest uppercase cursor-pointer text-left transition-colors", onClick: () => setExpanded((e) => !e), children: [_jsx("span", { children: expanded ? '▾' : '▸' }), _jsx("span", { children: "Files" }), loading && _jsx("span", { className: "text-[#444] text-[11px]", children: "\u2026" })] }), expanded && (_jsxs("div", { className: "max-h-[200px] overflow-y-auto px-1.5 pb-1.5", children: [tree.has('') && tree.get('').length === 0 && (_jsx("p", { className: "text-xs text-[#444] px-2.5 py-1.5 italic", children: "Empty directory" })), tree.has('') && renderEntries(tree.get(''), 0)] }))] }), viewer && (_jsx("div", { className: "fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 md:p-8", onClick: () => setViewer(null), children: _jsxs("div", { className: "bg-[#131313] border border-[#2a2a2a] rounded-xl w-full max-w-[860px] max-h-[80dvh] flex flex-col overflow-hidden", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-[#1f1f1f] gap-3", children: [_jsx("span", { className: "text-[13px] text-[#888] font-mono overflow-hidden text-ellipsis whitespace-nowrap", children: viewer.path }), _jsx("button", { className: "bg-transparent border-none text-[#666] hover:text-[#ccc] hover:bg-[#222] text-xl cursor-pointer flex-shrink-0 leading-none px-2 py-1 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center", onClick: () => setViewer(null), children: "\u00D7" })] }), _jsx("pre", { className: "flex-1 overflow-auto p-4 text-[13px] leading-relaxed font-['SF_Mono','Fira_Code',monospace] text-[#ccc] whitespace-pre bg-transparent border-none m-0", children: _jsx("code", { children: viewer.content }) })] }) }))] }));
}
