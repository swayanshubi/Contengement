export {};

declare global {
    interface Window {
        electronAPI?: {
            isDesktop: boolean;
            minimizeWindow: () => Promise<void>;
            toggleMaximizeWindow: () => Promise<boolean>;
            isWindowMaximized: () => Promise<boolean>;
            closeWindow: () => Promise<void>;
        };
    }
}
