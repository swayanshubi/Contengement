"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { HardDrive, Loader2 } from "lucide-react";

interface GoogleDrivePickerProps {
    onFilesPicked: (files: DriveFile[], accessToken: string) => void;
    disabled?: boolean;
}

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
}

declare global {
    interface Window {
        google: any;
        gapi: any;
    }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID || "";
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

export default function GoogleDrivePicker({
    onFilesPicked,
    disabled,
}: GoogleDrivePickerProps) {
    const [gapiLoaded, setGapiLoaded] = useState(false);
    const [gisLoaded, setGisLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const tokenClientRef = useRef<any>(null);
    const accessTokenRef = useRef<string>("");

    const isConfigured = Boolean(CLIENT_ID && (API_KEY || APP_ID));
    const isConfigured = CLIENT_ID && API_KEY;

    // Load GAPI (Picker)
    useEffect(() => {
        if (!isConfigured) return;
        const script = document.createElement("script");
        script.src = "https://apis.google.com/js/api.js";
        script.onload = () => {
            window.gapi.load("picker", () => setGapiLoaded(true));
        };
        document.head.appendChild(script);
        return () => {
            document.head.removeChild(script);
        };
    }, [isConfigured]);

    // Load GIS (OAuth)
    useEffect(() => {
        if (!isConfigured) return;
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.onload = () => {
            tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: (response: any) => {
                    if (response.access_token) {
                        accessTokenRef.current = response.access_token;
                        (window as any).__driveAccessToken = response.access_token;
                        openPicker(response.access_token);
                    }
                },
            });
            setGisLoaded(true);
        };
        document.head.appendChild(script);
        return () => {
            document.head.removeChild(script);
        };
    }, [isConfigured]);

    const openPicker = useCallback(
        (token: string) => {
            const view = new window.google.picker.DocsView()
                .setIncludeFolders(true)
                .setSelectFolderEnabled(false);

            let pickerBuilder = new window.google.picker.PickerBuilder();

            // App ID is optional for many picker configurations. Keep it opt-in so
            // Drive import still works when only API key + OAuth client are provided.
            if (APP_ID) {
                pickerBuilder = pickerBuilder.setAppId(APP_ID);
            }

            if (API_KEY) {
                pickerBuilder = pickerBuilder.setDeveloperKey(API_KEY);
            }

            const picker = pickerBuilder
                .setOAuthToken(token)
                .addView(view)
                .addView(
                    new window.google.picker.DocsView(
                        window.google.picker.ViewId.DOCS_VIDEOS
                    )
                )
                .addView(
                    new window.google.picker.DocsView(
                        window.google.picker.ViewId.DOCS_IMAGES
                    )
                )
                .setCallback((data: any) => {
                    if (data.action === "picked") {
                        const files: DriveFile[] = data.docs.map((doc: any) => ({
                            id: doc.id,
                            name: doc.name,
                            mimeType: doc.mimeType,
                            sizeBytes: doc.sizeBytes || 0,
                        }));
                        onFilesPicked(files, token);
                    }
                    setLoading(false);
                })
                .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
                .setTitle("Select files from Google Drive")
                .build();

            picker.setVisible(true);
        },
        [onFilesPicked]
    );

    function handleClick() {
        if (!tokenClientRef.current) return;
        setLoading(true);

        if (accessTokenRef.current) {
            openPicker(accessTokenRef.current);
        } else {
            tokenClientRef.current.requestAccessToken({ prompt: "consent" });
        }
    }

    if (!isConfigured) {
        return (
            <button
                disabled
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg
                           border border-border/30 text-zinc-600 text-xs cursor-not-allowed"
                title="Set NEXT_PUBLIC_GOOGLE_CLIENT_ID plus either NEXT_PUBLIC_GOOGLE_API_KEY or NEXT_PUBLIC_GOOGLE_APP_ID in .env.local"
                title="Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_API_KEY in .env.local (NEXT_PUBLIC_GOOGLE_APP_ID is optional)"
            >
                <HardDrive className="w-3.5 h-3.5" />
                Google Drive (Not configured)
            </button>
        );
    }

    const ready = gapiLoaded && gisLoaded;

    return (
        <button
            onClick={handleClick}
            disabled={!ready || loading || disabled}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg
                       border border-border/40 hover:border-accent/30 hover:bg-accent-muted
                       text-zinc-400 hover:text-zinc-200 text-xs
                       transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
            {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
                <HardDrive className="w-3.5 h-3.5" />
            )}
            {loading
                ? "Opening Drive..."
                : !ready
                    ? "Loading Google..."
                    : "Import from Google Drive"}
        </button>
    );
}
