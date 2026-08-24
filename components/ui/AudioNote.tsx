import React, { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';

export const isAudioSource = (src: unknown): src is string => {
    if (typeof src !== 'string') return false;
    const s = src.trim();
    if (!s) return false;
    return (
        s.startsWith('data:audio') ||
        s.startsWith('blob:') ||
        s.startsWith('http://') ||
        s.startsWith('https://') ||
        /\.(webm|ogg|mp3|wav|m4a|aac)(\?.*)?$/i.test(s)
    );
};

interface AudioNoteProps {
    src: string;
    className?: string;
    onError?: () => void;
    fallbackIcon?: React.ReactNode;
}

export const AudioNote: React.FC<AudioNoteProps> = ({ src, className, onError }) => {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let active = true;
        let createdUrl: string | null = null;
        setFailed(false);
        setObjectUrl(null);

        if (!src) {
            return;
        }

        if (src.startsWith('data:')) {
            setLoading(true);

            // Decode the base64 data URL manually instead of using fetch(),
            // which can fail on large or slightly-malformed data URLs.
            try {
                const commaIndex = src.indexOf(',');
                if (commaIndex === -1) throw new Error('Invalid data URL');

                const meta = src.slice(0, commaIndex); // e.g. "data:audio/webm;base64"
                const mimeMatch = meta.match(/^data:([^;,]+)/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'audio/webm';
                const raw = src.slice(commaIndex + 1);

                const byteString = atob(raw);
                const bytes = new Uint8Array(byteString.length);
                for (let i = 0; i < byteString.length; i++) {
                    bytes[i] = byteString.charCodeAt(i);
                }

                const blob = new Blob([bytes], { type: mimeType });
                if (!active || blob.size === 0) {
                    if (active) {
                        setFailed(true);
                        setLoading(false);
                    }
                    return;
                }
                createdUrl = URL.createObjectURL(blob);
                if (active) {
                    setObjectUrl(createdUrl);
                    setLoading(false);
                }
            } catch {
                if (active) {
                    setFailed(true);
                    setLoading(false);
                }
            }
        } else {
            // Direct URL (HTTP, HTTPS, blob)
            setObjectUrl(src);
            setLoading(false);
        }

        return () => {
            active = false;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [src]);

    if (failed) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-rose-500">
                <Mic size={11} />
                Playback unavailable
            </span>
        );
    }

    if (loading || !objectUrl) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                <Mic size={11} />
                Loading audio…
            </span>
        );
    }

    return (
        <audio
            controls
            src={objectUrl}
            className={className}
            preload="metadata"
            onError={() => {
                setFailed(true);
                onError?.();
            }}
        />
    );
};
