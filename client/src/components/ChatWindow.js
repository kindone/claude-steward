import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { sendMessage, getMessages, updateSystemPrompt, updatePermissionMode } from '../lib/api';
const MODES = [
    { value: 'plan', label: 'Plan', title: 'Read-only — Claude can analyse but not edit or run commands' },
    { value: 'acceptEdits', label: 'Edit', title: 'Claude can read and write files but not run shell commands' },
    { value: 'bypassPermissions', label: 'Full', title: 'Claude can run any tool including shell commands' },
];
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
export function ChatWindow({ sessionId, systemPrompt, permissionMode, onTitle, onActivity, onSystemPromptChange, onPermissionModeChange }) {
    const [messages, setMessages] = useState([]);
    const [streaming, setStreaming] = useState(false);
    const [streamingTool, setStreamingTool] = useState(null);
    const [promptOpen, setPromptOpen] = useState(false);
    const [promptDraft, setPromptDraft] = useState(systemPrompt ?? '');
    const bottomRef = useRef(null);
    const cancelRef = useRef(null);
    // Sync draft when switching sessions
    useEffect(() => {
        setPromptDraft(systemPrompt ?? '');
        setPromptOpen(false);
    }, [sessionId, systemPrompt]);
    async function handlePromptSave() {
        const value = promptDraft.trim() || null;
        await updateSystemPrompt(sessionId, value);
        onSystemPromptChange?.(value);
        setPromptOpen(false);
    }
    async function handleModeChange(mode) {
        await updatePermissionMode(sessionId, mode);
        onPermissionModeChange?.(mode);
    }
    function handlePromptKeyDown(e) {
        if (e.key === 'Escape') {
            setPromptDraft(systemPrompt ?? '');
            setPromptOpen(false);
        }
    }
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    useEffect(() => {
        let cancelled = false;
        getMessages(sessionId).then((loaded) => {
            if (!cancelled) {
                setMessages(loaded.map((m) => ({ ...m, streaming: false })));
            }
        }).catch(() => { });
        return () => {
            cancelled = true;
            cancelRef.current?.();
        };
    }, [sessionId]);
    function generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID)
            return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }
    function handleSend(text) {
        const userMsgId = generateId();
        const assistantMsgId = generateId();
        setMessages((prev) => [
            ...prev,
            { id: userMsgId, role: 'user', content: text, streaming: false },
            { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
        ]);
        setStreaming(true);
        cancelRef.current = sendMessage(sessionId, text, {
            onTitle,
            onActivity,
            onTextDelta: (delta) => {
                setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: m.content + delta } : m));
            },
            onToolActivity: (toolName) => setStreamingTool(toolName),
            onDone: () => {
                setStreamingTool(null);
                setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, streaming: false } : m));
                setStreaming(false);
            },
            onError: (errorMsg, code) => {
                setStreamingTool(null);
                setMessages((prev) => prev.map((m) => m.id === assistantMsgId
                    ? { ...m, content: errorMsg, streaming: false, errorCode: code }
                    : m));
                setStreaming(false);
            },
        });
    }
    return (_jsxs("div", { className: "flex flex-col h-full overflow-hidden", children: [_jsxs("div", { className: "flex-shrink-0 border-b border-[#1a1a1a]", children: [_jsxs("div", { className: "flex items-center justify-between px-2", children: [_jsx("button", { className: `bg-transparent border-none cursor-pointer text-xs py-1.5 px-1.5 text-left transition-colors flex-shrink-0
              ${systemPrompt ? 'text-blue-500 hover:text-blue-400' : 'text-[#444] hover:text-[#888]'}`, onClick: () => setPromptOpen((o) => !o), title: "System prompt", children: systemPrompt ? '⚙ Prompt set' : '⚙ Prompt' }), _jsx("span", { className: "inline-flex border border-[#222] rounded overflow-hidden", children: MODES.map((m) => (_jsx("button", { className: `bg-transparent border-r border-[#222] last:border-r-0 cursor-pointer text-xs px-3 py-2 transition-colors
                  ${permissionMode === m.value
                                        ? 'bg-[#1e3a5f] text-blue-400'
                                        : 'text-[#444] hover:bg-[#1a1a1a] hover:text-[#888]'}`, onClick: () => handleModeChange(m.value), title: m.title, children: m.label }, m.value))) })] }), promptOpen && (_jsxs("div", { className: "px-3 pb-3 flex flex-col gap-2", children: [_jsx("textarea", { className: "bg-[#0d0d0d] border border-[#2a2a2a] focus:border-blue-600 rounded-md text-[#e8e8e8] text-base font-[inherit] leading-relaxed px-2.5 py-2 resize-y outline-none w-full", value: promptDraft, onChange: (e) => setPromptDraft(e.target.value), onKeyDown: handlePromptKeyDown, placeholder: "Instructions sent to Claude before every message in this session\u2026", rows: 4, autoFocus: true }), _jsxs("div", { className: "flex gap-1.5", children: [_jsx("button", { className: "bg-blue-600 hover:bg-blue-500 border-none rounded text-white cursor-pointer text-xs px-3 py-1.5 transition-colors", onClick: handlePromptSave, children: "Save" }), _jsx("button", { className: "bg-transparent border border-[#2a2a2a] hover:border-[#444] hover:text-[#aaa] rounded text-[#666] cursor-pointer text-xs px-2.5 py-1.5 transition-colors", onClick: () => { setPromptDraft(systemPrompt ?? ''); setPromptOpen(false); }, children: "Cancel" }), systemPrompt && (_jsx("button", { className: "bg-transparent border border-[#2a2a2a] hover:text-red-500 hover:border-red-500/40 rounded text-[#555] cursor-pointer text-xs px-2.5 py-1.5 ml-auto transition-colors", onClick: async () => { await updateSystemPrompt(sessionId, null); onSystemPromptChange?.(null); setPromptDraft(''); setPromptOpen(false); }, children: "Clear" }))] })] }))] }), _jsxs("div", { className: "flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col gap-5", children: [messages.length === 0 && (_jsx("div", { className: "flex items-center justify-center flex-1 text-[#444] text-sm", children: _jsx("p", { children: "Start a conversation with Claude." }) })), messages.map((m) => (_jsx(MessageBubble, { role: m.role, content: m.content, streaming: m.streaming, errorCode: m.errorCode }, m.id))), streaming && (_jsxs("div", { className: "flex items-center gap-1 px-3 py-1.5", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[#555] tool-pulse" }), _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[#555] tool-pulse tool-pulse-2" }), _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[#555] tool-pulse tool-pulse-3" }), streamingTool && (_jsx("span", { className: "ml-1.5 text-xs text-[#888] italic", children: streamingTool }))] })), _jsx("div", { ref: bottomRef })] }), _jsx(MessageInput, { onSend: handleSend, onStop: () => {
                    cancelRef.current?.();
                    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
                    setStreaming(false);
                }, disabled: streaming })] }));
}
