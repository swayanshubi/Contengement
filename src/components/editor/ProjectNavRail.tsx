"use client";

import {
    FileText,
    LayoutTemplate,
    NotebookPen,
    PenSquare,
    Rows4,
    ScrollText,
} from "lucide-react";

type EditorView = "scene" | "storyboard" | "shot-list" | "master-script" | "notes";

interface ProjectNavRailProps {
    projectTitle: string;
    editorView: EditorView;
    onChangeView: (view: EditorView) => void;
    onOpenScript: () => void;
}

const NAV_ITEMS: Array<{
    id: EditorView;
    label: string;
    icon: typeof PenSquare;
    hint: string;
}> = [
    {
        id: "master-script",
        label: "Master",
        icon: ScrollText,
        hint: "Write the full screenplay",
    },
    {
        id: "notes",
        label: "Notes",
        icon: NotebookPen,
        hint: "Capture freeform personal notes",
    },
    {
        id: "scene",
        label: "Scenes",
        icon: PenSquare,
        hint: "Write and organize scenes",
    },
    {
        id: "shot-list",
        label: "Shots",
        icon: Rows4,
        hint: "Plan the shot list",
    },
    {
        id: "storyboard",
        label: "Board",
        icon: LayoutTemplate,
        hint: "Open storyboard workspace",
    },
];

export default function ProjectNavRail({
    projectTitle,
    editorView,
    onChangeView,
    onOpenScript,
}: ProjectNavRailProps) {
    return (
        <aside className="h-full w-[92px] shrink-0 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,14,18,0.94)_0%,rgba(8,8,12,0.9)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <div className="flex h-full flex-col items-center gap-4 px-3 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300">
                        {projectTitle.slice(0, 2)}
                    </span>
                </div>

                <div className="flex w-full flex-col gap-2">
                    {NAV_ITEMS.map((item) => {
                        const Icon = item.icon;
                        const isActive = editorView === item.id;

                        return (
                            <button
                                key={item.id}
                                onClick={() => onChangeView(item.id)}
                                className={`group flex w-full flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center transition-all duration-200 ${
                                    isActive
                                        ? "border-cyan-400/35 bg-[linear-gradient(180deg,rgba(34,211,238,0.22)_0%,rgba(59,130,246,0.14)_100%)] text-white shadow-[0_0_0_1px_rgba(34,211,238,0.18)]"
                                        : "border-white/6 bg-white/[0.03] text-zinc-500 hover:border-white/10 hover:bg-white/[0.06] hover:text-zinc-200"
                                }`}
                                title={item.hint}
                            >
                                <Icon
                                    className={`h-4 w-4 transition-transform duration-200 ${
                                        isActive ? "scale-110 text-cyan-200" : "group-hover:scale-105"
                                    }`}
                                />
                                <span className="text-[11px] font-medium leading-tight">
                                    {item.label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-auto flex w-full flex-col gap-2">
                    <button
                        onClick={onOpenScript}
                        className="flex w-full flex-col items-center gap-1 rounded-2xl border border-white/6 bg-white/[0.03] px-2 py-3 text-zinc-500 transition-all duration-200 hover:border-white/10 hover:bg-white/[0.06] hover:text-zinc-200"
                        title="Open full compiled script"
                    >
                        <FileText className="h-4 w-4" />
                        <span className="text-[11px] font-medium leading-tight">
                            Script
                        </span>
                    </button>
                </div>
            </div>
        </aside>
    );
}
