import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
marked.use({
    breaks: true,
});
export function MessageBubble({ role, content, streaming = false, errorCode }) {
    const contentRef = useRef(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (contentRef.current && role === 'assistant' && !errorCode) {
            contentRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }, [content, role, errorCode]);
    async function handleCopy() {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }
    if (errorCode) {
        const isSessionExpired = errorCode === 'session_expired';
        return (_jsxs("div", { className: `flex items-start gap-2 px-3.5 py-2.5 rounded-lg text-sm leading-relaxed
        ${isSessionExpired
                ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-300'
                : 'bg-red-500/10 border border-red-500/30 text-red-300'}`, children: [_jsx("span", { className: "flex-shrink-0 text-sm mt-px", children: isSessionExpired ? '⚠' : '✕' }), _jsx("p", { className: "flex-1", children: content })] }));
    }
    return (_jsx("div", { className: `max-w-[820px] w-full flex flex-col
      ${role === 'user' ? 'self-end items-end' : 'self-start items-start'}`, children: role === 'user' ? (_jsx("p", { className: "bg-[#1e3a5f] px-3.5 py-2.5 rounded-[14px_14px_2px_14px] whitespace-pre-wrap break-words text-sm leading-relaxed max-w-[600px]", children: content })) : (_jsxs("div", { className: "group relative w-full", children: [_jsx("div", { ref: contentRef, className: `prose text-sm leading-[1.65] break-words w-full${streaming ? ' streaming-cursor' : ''}`, dangerouslySetInnerHTML: { __html: marked.parse(content) } }), !streaming && content && (_jsx("button", { className: `absolute top-1 right-1 bg-[#1a1a1a] border border-[#2a2a2a] text-[#555]
                rounded cursor-pointer text-[13px] leading-none px-1.5 py-0.5 transition-[opacity,color,border-color]
                opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100
                hover:text-[#ccc] hover:border-[#444]
                ${copied ? '!text-green-400 !border-green-400/30 !opacity-100' : ''}`, onClick: handleCopy, title: "Copy message", children: copied ? '✓' : '⎘' }))] })) }));
}
