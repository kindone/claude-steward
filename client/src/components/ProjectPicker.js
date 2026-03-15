import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
export function ProjectPicker({ projects, activeProjectId, onSelect, onCreate, onDelete, protectedPath }) {
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [pathVal, setPathVal] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const dropdownRef = useRef(null);
    const activeProject = projects.find((p) => p.id === activeProjectId);
    // Close dropdown on outside click
    useEffect(() => {
        if (!open)
            return;
        function handler(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpen(false);
                setCreating(false);
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);
    async function handleCreate(e) {
        e.preventDefault();
        if (!name.trim() || !pathVal.trim())
            return;
        setError('');
        setSubmitting(true);
        try {
            await onCreate(name.trim(), pathVal.trim());
            setName('');
            setPathVal('');
            setCreating(false);
            setOpen(false);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setSubmitting(false);
        }
    }
    function handleDelete(e, id) {
        e.stopPropagation();
        if (window.confirm('Delete this project? Sessions will be unlinked but not deleted.')) {
            onDelete(id);
        }
    }
    return (_jsxs("div", { className: "relative", ref: dropdownRef, children: [_jsxs("button", { className: "w-full flex items-center justify-between px-3 py-2.5 bg-transparent border-none text-[#ccc] hover:bg-[#1a1a1a] hover:text-white cursor-pointer text-sm font-semibold text-left gap-1.5 transition-colors min-h-[44px]", onClick: () => setOpen((o) => !o), title: "Switch project", children: [_jsx("span", { className: "flex-1 overflow-hidden text-ellipsis whitespace-nowrap", children: activeProject ? activeProject.name : 'Select project…' }), _jsx("span", { className: "text-[#555] text-[10px] flex-shrink-0", children: open ? '▴' : '▾' })] }), open && (_jsxs("div", { className: "absolute top-full left-0 right-0 bg-[#161616] border border-[#2a2a2a] rounded-lg z-[100] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.5)]", children: [_jsx("ul", { className: "list-none p-1 max-h-[200px] overflow-y-auto", children: projects.map((p) => (_jsxs("li", { className: `group flex items-center gap-1 px-2.5 py-2 rounded cursor-pointer text-sm transition-colors
                  ${p.id === activeProjectId
                                ? 'bg-[#1e3a5f] text-[#e8e8e8]'
                                : 'text-[#bbb] hover:bg-[#222] hover:text-white'}`, onClick: () => { onSelect(p.id); setOpen(false); }, children: [_jsx("span", { className: "flex-1 overflow-hidden text-ellipsis whitespace-nowrap", children: p.name }), p.path !== protectedPath && (_jsx("button", { className: "bg-transparent border-none text-[#666] cursor-pointer text-[15px] px-0.5 rounded leading-none flex-shrink-0 transition-colors\n                      hidden group-hover:block [@media(hover:none)]:block\n                      hover:text-red-500 hover:bg-red-500/15", onClick: (e) => handleDelete(e, p.id), title: "Delete project", children: "\u00D7" }))] }, p.id))) }), _jsx("div", { className: "border-t border-[#222] p-1.5", children: !creating ? (_jsx("button", { className: "w-full bg-transparent border-none text-[#555] text-xs px-2 py-1.5 cursor-pointer text-left rounded hover:bg-[#1e1e1e] hover:text-[#aaa] transition-colors", onClick: () => setCreating(true), children: "+ New project" })) : (_jsxs("form", { className: "flex flex-col gap-1.5 p-0.5", onSubmit: handleCreate, children: [_jsx("input", { autoFocus: true, className: "bg-[#1a1a1a] border border-[#2a2a2a] focus:border-blue-600 rounded text-[#e8e8e8] text-base px-2 py-1.5 outline-none font-[inherit]", placeholder: "Project name", value: name, onChange: (e) => setName(e.target.value) }), _jsx("input", { className: "bg-[#1a1a1a] border border-[#2a2a2a] focus:border-blue-600 rounded text-[#e8e8e8] text-base px-2 py-1.5 outline-none font-[inherit]", placeholder: "/absolute/path/on/server", value: pathVal, onChange: (e) => setPathVal(e.target.value) }), error && _jsx("p", { className: "text-[11px] text-red-400", children: error }), _jsxs("div", { className: "flex gap-1.5 justify-end", children: [_jsx("button", { type: "button", className: "bg-transparent border border-[#333] hover:border-[#555] hover:text-[#bbb] rounded text-[#888] text-xs px-2.5 py-1.5 cursor-pointer transition-colors", onClick: () => { setCreating(false); setError(''); }, children: "Cancel" }), _jsx("button", { type: "submit", className: "bg-blue-600 hover:bg-blue-500 disabled:bg-[#1e2a3a] disabled:text-[#555] disabled:cursor-not-allowed border-none rounded text-white text-xs px-3 py-1.5 cursor-pointer transition-colors", disabled: submitting || !name.trim() || !pathVal.trim(), children: submitting ? 'Adding…' : 'Add' })] })] })) })] }))] }));
}
