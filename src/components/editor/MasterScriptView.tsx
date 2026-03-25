"use client";

import { useEffect, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import type { MasterScriptBlockType, Project, Scene } from "@/lib/types";

interface MasterScriptViewProps {
    project: Project;
    scenes: Scene[];
    onUpdateProject: (updates: Record<string, unknown>) => void;
    onCreateSceneFromScript: (input: {
        title: string;
        scriptBody: string;
    }) => Promise<void>;
}

const FORMATS: Array<{ id: MasterScriptBlockType; label: string }> = [
    { id: "heading", label: "Heading" },
    { id: "action", label: "Action" },
    { id: "character", label: "Character" },
    { id: "dialogue", label: "Dialogue" },
    { id: "parenthetical", label: "Parenthetical" },
    { id: "transition", label: "Transition" },
];

const FORMAT_HINTS: Record<MasterScriptBlockType, string> = {
    heading: "Scene heading: INT/EXT, location, and time",
    action: "Scene actions and visual beats",
    character: "Character speaking name",
    dialogue: "Spoken line",
    parenthetical: "Performance direction",
    transition: "Cut/transition cue",
};

const DOCUMENT_BASE_CLASS =
    "min-h-[140vh] pb-[45vh] rounded-2xl border border-zinc-700/90 bg-[linear-gradient(180deg,rgba(52,57,66,0.98)_0%,rgba(39,44,53,0.98)_100%)] text-zinc-100 shadow-[0_20px_60px_rgba(2,6,23,0.4)] px-12 py-10 leading-7 outline-none";

const LINE_CLASS_MAP: Record<MasterScriptBlockType, string> = {
    heading: "font-semibold tracking-wide ml-[8%] mr-[12%] whitespace-pre-wrap",
    action: "ml-[8%] mr-[8%] whitespace-pre-wrap",
    character: "font-semibold ml-[40%] w-[26%] whitespace-pre-wrap",
    dialogue: "ml-[30%] w-[40%] whitespace-pre-wrap",
    parenthetical: "italic text-zinc-300 ml-[34%] w-[32%] whitespace-pre-wrap",
    transition: "font-semibold ml-[58%] w-[34%] whitespace-pre-wrap",
};

const GHOST_WORDS = [
    "office",
    "outside",
    "inside",
    "character",
    "dialogue",
    "transition",
    "location",
    "morning",
    "night",
    "camera",
    "action",
    "continue",
    "whispers",
];

function makeInitialDocumentHtml(project: Project): string {
    if (project.masterScript?.documentHtml?.trim()) return project.masterScript.documentHtml;
    return `<div data-script-line="true" data-format="heading" class="${LINE_CLASS_MAP.heading}">INT. LOCATION - DAY</div><div data-script-line="true" data-format="action" class="${LINE_CLASS_MAP.action}"><br></div>`;
}

function closestLine(node: Node | null): HTMLElement | null {
    if (!node) return null;
    if (node instanceof HTMLElement && node.dataset.scriptLine === "true") return node;
    if (node instanceof HTMLElement) return node.closest('[data-script-line="true"]');
    if (node.parentElement) return node.parentElement.closest('[data-script-line="true"]');
    return null;
}

function getCaretCoordinates(
    editor: HTMLDivElement,
    range: Range
): { left: number; top: number } | null {
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    marker.style.opacity = "0";
    marker.style.pointerEvents = "none";
    marker.style.userSelect = "none";

    const clone = range.cloneRange();
    clone.collapse(true);
    clone.insertNode(marker);

    const markerRect = marker.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const result = {
        left: Math.max(0, markerRect.left - editorRect.left),
        top: Math.max(0, markerRect.top - editorRect.top),
    };

    marker.parentNode?.removeChild(marker);
    return result;
}

export default function MasterScriptView({
    project,
    scenes,
    onUpdateProject,
    onCreateSceneFromScript,
}: MasterScriptViewProps) {
    const editorRef = useRef<HTMLDivElement>(null);
    const activeFormatRef = useRef<MasterScriptBlockType>("action");
    const saveTimer = useRef<NodeJS.Timeout | null>(null);
    const savedHtmlRef = useRef<string>(makeInitialDocumentHtml(project));
    const selectionRangeRef = useRef<Range | null>(null);
    const [activeFormat, setActiveFormat] = useState<MasterScriptBlockType>("action");
    const [isConverting, setIsConverting] = useState(false);
    const [isEditorEmpty, setIsEditorEmpty] = useState(false);
    const [hoverHint, setHoverHint] = useState<string>("");
    const [ghostSuffix, setGhostSuffix] = useState("");
    const [ghostPosition, setGhostPosition] = useState({ left: 0, top: 0 });

    useEffect(() => {
        const nextHtml = makeInitialDocumentHtml(project);
        const editor = editorRef.current;
        if (!editor) {
            savedHtmlRef.current = nextHtml;
            return;
        }

        const editorEmpty = !editor.innerHTML || !editor.innerHTML.trim();
        if (!editorEmpty && nextHtml === savedHtmlRef.current) return;
        if (document.activeElement === editor) return;

        editor.innerHTML = nextHtml;
        ensureLineClasses(editor);
        savedHtmlRef.current = editor.innerHTML;
        setIsEditorEmpty(!editor.textContent?.trim());
        updateActiveFormatFromSelection();
    }, [project.id, project.masterScript?.documentHtml]);

    function queueSave(nextHtml: string) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            onUpdateProject({
                masterScript: {
                    version: 2,
                    documentHtml: nextHtml,
                },
            });
        }, 220);
    }

    function ensureLineClasses(editor: HTMLDivElement) {
        const children = Array.from(editor.children) as HTMLElement[];
        if (!children.length) {
            const line = document.createElement("div");
            line.dataset.scriptLine = "true";
            line.dataset.format = "action";
            line.className = LINE_CLASS_MAP.action;
            line.innerHTML = "<br>";
            editor.appendChild(line);
            return;
        }

        children.forEach((line) => {
            line.dataset.scriptLine = "true";
            const format = (line.dataset.format as MasterScriptBlockType) || "action";
            line.dataset.format = format;
            line.className = LINE_CLASS_MAP[format] || LINE_CLASS_MAP.action;
            line.style.direction = "ltr";
        });
    }

    function syncFromEditor() {
        const editor = editorRef.current;
        if (!editor) return;
        ensureLineClasses(editor);
        const next = editor.innerHTML;
        savedHtmlRef.current = next;
        setIsEditorEmpty(!editor.textContent?.trim());
        updateGhostSuggestion();
        queueSave(next);
    }

    function captureSelectionRange() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (!editorRef.current?.contains(range.commonAncestorContainer)) return;
        selectionRangeRef.current = range.cloneRange();
    }

    function restoreSelectionRange(): Range | null {
        const saved = selectionRangeRef.current;
        const selection = window.getSelection();
        if (!saved || !selection) return null;
        selection.removeAllRanges();
        selection.addRange(saved);
        return saved;
    }

    function applyFormat(format: MasterScriptBlockType) {
        const range = restoreSelectionRange();
        const editor = editorRef.current;
        const line =
            closestLine(range?.startContainer || null) ||
            ((editor?.firstElementChild as HTMLElement | null) ?? null);
        if (!line) return;
        line.dataset.format = format;
        line.className = LINE_CLASS_MAP[format];
        line.style.direction = "ltr";
        if (activeFormatRef.current !== format) {
            activeFormatRef.current = format;
            setActiveFormat(format);
        }
        captureSelectionRange();
        updateGhostSuggestion();
        syncFromEditor();
    }

    function insertSuggestion(text: string) {
        const range = restoreSelectionRange();
        if (!range || !editorRef.current?.contains(range.commonAncestorContainer)) return;
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
        captureSelectionRange();
        syncFromEditor();
    }

    function updateActiveFormatFromSelection() {
        captureSelectionRange();
        const selection = window.getSelection();
        const editor = editorRef.current;
        const line =
            closestLine(selection?.anchorNode || null) ||
            ((editor?.firstElementChild as HTMLElement | null) ?? null);
        if (!line) return;
        const format = (line.dataset.format as MasterScriptBlockType) || "action";
        if (activeFormatRef.current !== format) {
            activeFormatRef.current = format;
            setActiveFormat(format);
        }
        updateGhostSuggestion();
    }

    function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (event.key !== "Enter") return;
        const editor = editorRef.current;
        if (!editor) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const line = closestLine(range.startContainer);
        if (!line) return;

        event.preventDefault();
        const format = (line.dataset.format as MasterScriptBlockType) || "action";
        const nextLine = document.createElement("div");
        nextLine.dataset.scriptLine = "true";
        nextLine.dataset.format = format;
        nextLine.className = LINE_CLASS_MAP[format];
        nextLine.style.direction = "ltr";
        nextLine.innerHTML = "<br>";
        line.insertAdjacentElement("afterend", nextLine);

        const nextRange = document.createRange();
        nextRange.setStart(nextLine, 0);
        nextRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(nextRange);
        selectionRangeRef.current = nextRange.cloneRange();
        updateGhostSuggestion();
        syncFromEditor();
    }

    function updateGhostSuggestion() {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
            setGhostSuffix("");
            return;
        }

        const range = selection.getRangeAt(0);
        if (!editor.contains(range.endContainer)) {
            setGhostSuffix("");
            return;
        }

        const line = closestLine(range.endContainer);
        if (!line) {
            setGhostSuffix("");
            return;
        }

        const lineRange = document.createRange();
        lineRange.selectNodeContents(line);
        lineRange.setEnd(range.endContainer, range.endOffset);
        const typedBeforeCaret = lineRange.toString();
        const prefixMatch = typedBeforeCaret.match(/([A-Za-z]{2,})$/);
        const prefix = prefixMatch?.[1] || "";
        if (!prefix) {
            setGhostSuffix("");
            return;
        }

        const found = GHOST_WORDS.find(
            (word) =>
                word.toLowerCase().startsWith(prefix.toLowerCase()) &&
                word.length > prefix.length
        );
        if (!found) {
            setGhostSuffix("");
            return;
        }

        const rawSuffix = found.slice(prefix.length);
        const suffix = prefix.toUpperCase() === prefix ? rawSuffix.toUpperCase() : rawSuffix;
        const caret = getCaretCoordinates(editor, range);
        if (!caret) {
            setGhostSuffix("");
            return;
        }
        setGhostPosition({
            left: caret.left + 2,
            top: caret.top,
        });
        setGhostSuffix(suffix);
    }

    async function convertSelectionToScene() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const selectedText = selection.toString().trim();
        if (!selectedText) return;
        if (!editorRef.current?.contains(selection.anchorNode)) return;

        const firstLine = selectedText.split("\n").map((line) => line.trim()).find(Boolean);
        const title = firstLine || `Master Script Scene ${scenes.length + 1}`;

        setIsConverting(true);
        try {
            await onCreateSceneFromScript({
                title,
                scriptBody: selectedText,
            });
        } finally {
            setIsConverting(false);
        }
    }

    return (
        <main className="flex-1 overflow-y-auto bg-[var(--bg-primary)] p-6">
            <div className="max-w-5xl mx-auto space-y-4">
                <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-surface/85 backdrop-blur px-3 py-2">
                    {FORMATS.map((item) => (
                        <button
                            key={item.id}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                applyFormat(item.id);
                            }}
                            onMouseEnter={() => setHoverHint(FORMAT_HINTS[item.id])}
                            onMouseLeave={() => setHoverHint("")}
                            className={`rounded-lg px-2.5 py-1.5 text-xs border transition ${
                                activeFormat === item.id
                                    ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                                    : "border-border/50 text-zinc-300 hover:bg-zinc-800/70"
                            }`}
                            title={FORMAT_HINTS[item.id]}
                        >
                            {item.label}
                        </button>
                    ))}
                    <div className="h-5 w-px bg-border/60 mx-1" />
                    <button
                        onMouseDown={(event) => {
                            event.preventDefault();
                            void convertSelectionToScene();
                        }}
                        disabled={isConverting}
                        className={`rounded-lg px-3 py-1.5 text-xs border transition ${
                            isConverting
                                ? "border-border/50 text-zinc-500 cursor-not-allowed"
                                : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                        }`}
                    >
                        <Wand2 className="w-3.5 h-3.5 inline mr-1" />
                        Convert Selection To Scene
                    </button>
                </div>

                {hoverHint && (
                    <p className="text-xs text-zinc-400 px-1">{hoverHint}</p>
                )}

                <div className="relative">
                    {isEditorEmpty && (
                        <div className="pointer-events-none absolute left-12 top-10 z-10 text-zinc-400/80 text-base">
                            Write Your Script Here
                        </div>
                    )}
                    {ghostSuffix && (
                        <div
                            className="pointer-events-none absolute z-20 text-zinc-400/80 text-base"
                            style={{ left: ghostPosition.left, top: ghostPosition.top }}
                        >
                            {ghostSuffix}
                        </div>
                    )}
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        className={DOCUMENT_BASE_CLASS}
                        onInput={syncFromEditor}
                        onKeyDown={handleEditorKeyDown}
                        onMouseUp={updateActiveFormatFromSelection}
                        onKeyUp={updateActiveFormatFromSelection}
                        onBlur={captureSelectionRange}
                        onFocus={updateActiveFormatFromSelection}
                    />
                </div>
            </div>
        </main>
    );
}
