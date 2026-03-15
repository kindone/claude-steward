import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { FileTree } from './FileTree';
export function SessionSidebar({ projects, activeProjectId, onSelectProject, onCreateProject, onDeleteProject, protectedProjectPath, sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession, onDeleteAllSessions, onRenameSession, loading, onClose, }) {
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const editInputRef = useRef(null);
    useEffect(() => {
        if (editingId)
            editInputRef.current?.select();
    }, [editingId]);
    function startEditing(e, session) {
        e.stopPropagation();
        setPendingDeleteId(null);
        setEditingId(session.id);
        setEditValue(session.title);
    }
    async function commitRename() {
        if (!editingId)
            return;
        const trimmed = editValue.trim();
        if (trimmed)
            await onRenameSession(editingId, trimmed);
        setEditingId(null);
    }
    function cancelRename() {
        setEditingId(null);
    }
    function handleSessionClick(id) {
        setPendingDeleteId(null);
        onSelectSession(id);
    }
    function handleDeleteClick(e, id) {
        e.stopPropagation();
        setPendingDeleteId(pendingDeleteId === id ? null : id);
    }
    function handleConfirmDelete(e, id) {
        e.stopPropagation();
        setPendingDeleteId(null);
        onDeleteSession(id);
    }
    function handleCancelDelete(e) {
        e.stopPropagation();
        setPendingDeleteId(null);
    }
    function handleClearAll(e) {
        e.stopPropagation();
        if (sessions.length === 0)
            return;
        if (window.confirm(`Delete all ${sessions.length} session${sessions.length === 1 ? '' : 's'} and their messages?`)) {
            onDeleteAllSessions();
        }
    }
    return (_jsxs("aside", { className: "h-dvh w-64 flex flex-col bg-[#111] border-r border-[#1f1f1f] overflow-hidden", children: [_jsx("div", { className: "flex items-center justify-end px-2 pt-2 md:hidden", children: _jsx("button", { onClick: onClose, className: "w-9 h-9 flex items-center justify-center text-[#555] hover:text-[#aaa] text-xl rounded", "aria-label": "Close sidebar", children: "\u2715" }) }), _jsx("div", { className: "border-b border-[#1f1f1f] relative", children: _jsx(ProjectPicker, { projects: projects, activeProjectId: activeProjectId, onSelect: onSelectProject, onCreate: onCreateProject, onDelete: onDeleteProject, protectedPath: protectedProjectPath }) }), _jsxs("div", { className: "flex items-center justify-between px-3 pt-2 pb-1", children: [_jsxs("span", { className: "flex items-center gap-1.5 text-[11px] font-semibold text-[#555] tracking-widest uppercase", children: ["Sessions", sessions.length > 0 && (_jsx("span", { className: "bg-[#2a2a2a] text-[#666] text-[10px] font-semibold px-1.5 py-px rounded-full", children: sessions.length }))] }), _jsxs("div", { className: "flex items-center gap-1", children: [sessions.length > 1 && (_jsx("button", { className: "bg-transparent border-none text-[#444] text-[11px] cursor-pointer px-1.5 py-0.5 rounded hover:text-red-500 hover:bg-red-500/[0.08] transition-colors", onClick: handleClearAll, title: "Delete all sessions", children: "Clear all" })), _jsx("button", { className: "bg-[#1e3a5f] hover:bg-blue-600 text-white border-none w-8 h-8 rounded-md cursor-pointer text-lg leading-none flex items-center justify-center transition-colors", onClick: onNewSession, title: "New Chat", children: "+" })] })] }), _jsxs("ul", { className: "list-none flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5", children: [sessions.map((s) => (_jsx("li", { className: `group flex items-center gap-1 px-2.5 py-2 rounded-md cursor-pointer text-sm border transition-colors
              ${s.id === activeSessionId
                            ? 'bg-[#1e3a5f] text-[#e8e8e8] border-transparent'
                            : 'text-[#bbb] border-transparent hover:bg-[#1a1a1a] hover:text-[#e8e8e8]'}
              ${pendingDeleteId === s.id ? '!bg-red-500/[0.08] !border-red-500/20' : ''}`, onClick: () => handleSessionClick(s.id), children: editingId === s.id ? (_jsx("input", { ref: editInputRef, className: "flex-1 bg-[#0d0d0d] border border-blue-600 rounded text-[#e8e8e8] text-[13px] px-1.5 py-0.5 outline-none min-w-0", value: editValue, onChange: (e) => setEditValue(e.target.value), onBlur: commitRename, onKeyDown: (e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitRename();
                                }
                                if (e.key === 'Escape')
                                    cancelRename();
                            }, onClick: (e) => e.stopPropagation() })) : pendingDeleteId === s.id ? (_jsxs("span", { className: "flex items-center gap-1.5 w-full", children: [_jsx("span", { className: "flex-1 text-[12px] text-red-300", children: "Delete?" }), _jsx("button", { className: "bg-transparent border border-red-500/50 rounded text-red-500 text-[11px] px-2 py-1 cursor-pointer flex-shrink-0 hover:bg-red-500/15 min-h-[32px]", onClick: (e) => handleConfirmDelete(e, s.id), children: "Yes" }), _jsx("button", { className: "bg-transparent border border-[#333] rounded text-[#666] text-[11px] px-2 py-1 cursor-pointer flex-shrink-0 hover:text-[#aaa] hover:border-[#555] min-h-[32px]", onClick: handleCancelDelete, children: "No" })] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-none", onDoubleClick: (e) => startEditing(e, s), title: "Double-click to rename", children: s.title }), _jsx("button", { className: "flex-shrink-0 bg-transparent border-none cursor-pointer text-[15px] leading-none px-1 py-0.5 rounded transition-colors\n                    text-transparent group-hover:text-[#444] [@media(hover:none)]:text-[#444]\n                    hover:!text-red-500 hover:bg-red-500/10", onClick: (e) => handleDeleteClick(e, s.id), title: "Delete session", children: "\u00D7" })] })) }, s.id))), !loading && sessions.length === 0 && (_jsx("li", { className: "px-2.5 py-2 text-[12px] text-[#444] italic", children: "No sessions yet" }))] }), loading && _jsx("p", { className: "px-3 py-3 text-[12px] text-[#555] text-center", children: "Loading\u2026" }), activeProjectId && _jsx(FileTree, { projectId: activeProjectId })] }));
}
