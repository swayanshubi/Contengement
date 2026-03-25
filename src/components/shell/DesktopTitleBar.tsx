"use client";

import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

export default function DesktopTitleBar() {
    const [isDesktop, setIsDesktop] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        const desktop = Boolean(window.electronAPI?.isDesktop);
        setIsDesktop(desktop);
        document.documentElement.classList.toggle("desktop-app", desktop);
        if (desktop) {
            window.electronAPI?.isWindowMaximized().then((value) => {
                setIsMaximized(Boolean(value));
            });
        }
        return () => {
            document.documentElement.classList.remove("desktop-app");
        };
    }, []);

    if (!isDesktop) return null;

    return (
        <div className="app-titlebar">
            <div className="app-titlebar-drag" />
            <div className="app-titlebar-brand">Contengement</div>
            <div className="app-titlebar-controls no-drag">
                <button
                    className="titlebar-btn"
                    onClick={() => window.electronAPI?.minimizeWindow()}
                    aria-label="Minimize"
                >
                    <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                    className="titlebar-btn"
                    onClick={async () => {
                        const nextMax = await window.electronAPI?.toggleMaximizeWindow();
                        setIsMaximized(Boolean(nextMax));
                    }}
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                >
                    {isMaximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                </button>
                <button
                    className="titlebar-btn titlebar-btn-close"
                    onClick={() => window.electronAPI?.closeWindow()}
                    aria-label="Close"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
