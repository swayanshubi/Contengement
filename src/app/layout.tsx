import type { Metadata } from "next";
import "./globals.css";
import DesktopTitleBar from "@/components/shell/DesktopTitleBar";

export const metadata: Metadata = {
    title: "Contengement - Content Management",
    description:
        "Contengement is a content management workspace for planning, structuring, and executing production projects.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className="dark">
            <body className="min-h-screen antialiased">
                <DesktopTitleBar />
                <div className="app-shell">{children}</div>
            </body>
        </html>
    );
}
