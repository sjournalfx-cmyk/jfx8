import React, { useEffect, useRef, useState } from 'react';
import { Layout, Target, Clock, Calendar, Mic, Trash2, Square } from 'lucide-react';
import { AssetType } from '../../types';
import { Select } from '../Select';
import { Input } from '../ui/Input';
import { StarRating } from '../ui/StarRating';
import RichTextEditor from '../RichTextEditor';
import { FeatureGate } from '../ui/FeatureGate';
import { AudioNote, isAudioSource } from '../ui/AudioNote';
import { cn } from '../../lib/utils';

interface TradeFormStep1Props {
    formData: any;
    handleInputChange: (field: string, value: any) => void;
    pairError: string | null;
    isDarkMode: boolean;
    userProfile: any;
    isDesktopBridgeTrade?: boolean;
}

const MAX_VOICE_NOTE_SECONDS = 180;

const formatDuration = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const TradeFormStep1: React.FC<TradeFormStep1Props> = ({
    formData,
    handleInputChange,
    pairError,
    isDarkMode,
    userProfile,
    isDesktopBridgeTrade = false,
}) => {
    const [voiceNoteError, setVoiceNoteError] = useState<string | null>(null);
    const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recordingSecondsRef = useRef(0);
    const isAudioVoiceNote = isAudioSource(formData.voiceNote);

    const cleanupVoiceNoteRecording = () => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
        mediaChunksRef.current = [];
    };

    useEffect(() => {
        return () => {
            try {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    mediaRecorderRef.current.stop();
                }
            } catch {}
            cleanupVoiceNoteRecording();
        };
    }, []);

    const stopVoiceNoteRecording = () => {
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            } else {
                cleanupVoiceNoteRecording();
                setIsRecordingVoiceNote(false);
            }
        } catch {
            cleanupVoiceNoteRecording();
            setIsRecordingVoiceNote(false);
        }
    };

    const startVoiceNoteRecording = async () => {
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setVoiceNoteError(
                window.isSecureContext === false
                    ? 'Audio recording needs a secure (HTTPS) connection.'
                    : 'Audio recording is not supported in this browser.'
            );
            return;
        }

        setVoiceNoteError(null);

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch {
            setVoiceNoteError('Microphone access was denied. Allow it and try again.');
            return;
        }

        mediaStreamRef.current = stream;
        mediaChunksRef.current = [];

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : '';
        let recorder: MediaRecorder;
        try {
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        } catch {
            cleanupVoiceNoteRecording();
            setVoiceNoteError('Could not start audio recording.');
            return;
        }

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                mediaChunksRef.current.push(event.data);
            }
        };

        recorder.onstop = () => {
            try {
                const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
                if (blob.size > 0) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        if (typeof reader.result === 'string') {
                            handleInputChange('voiceNote', reader.result);
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            } catch {
                setVoiceNoteError('Could not save the recording. Try again.');
            }
            cleanupVoiceNoteRecording();
            recordingSecondsRef.current = 0;
            setRecordingSeconds(0);
            setIsRecordingVoiceNote(false);
        };

        recorder.onerror = () => {
            setVoiceNoteError('Voice recording stopped unexpectedly. Try again.');
            cleanupVoiceNoteRecording();
            recordingSecondsRef.current = 0;
            setRecordingSeconds(0);
            setIsRecordingVoiceNote(false);
        };

        mediaRecorderRef.current = recorder;
        recordingSecondsRef.current = 0;
        setRecordingSeconds(0);
        setIsRecordingVoiceNote(true);

        recordingTimerRef.current = setInterval(() => {
            recordingSecondsRef.current += 1;
            setRecordingSeconds(recordingSecondsRef.current);
            if (recordingSecondsRef.current >= MAX_VOICE_NOTE_SECONDS) {
                stopVoiceNoteRecording();
            }
        }, 1000);

        try {
            recorder.start(250);
        } catch {
            cleanupVoiceNoteRecording();
            recordingSecondsRef.current = 0;
            setRecordingSeconds(0);
            setIsRecordingVoiceNote(false);
            setVoiceNoteError('Could not start audio recording.');
        }
    };

    const toggleVoiceNoteRecording = () => {
        if (isRecordingVoiceNote) {
            stopVoiceNoteRecording();
        } else {
            void startVoiceNoteRecording();
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="col-span-2 md:col-span-1">
                <Input
                    label="Asset Pair"
                    leftIcon={<Layout size={16} />}
                    placeholder="e.g. EURUSD"
                    value={formData.pair}
                    onChange={(e) => handleInputChange('pair', e.target.value.toUpperCase())}
                    error={pairError || undefined}
                    isDarkMode={isDarkMode}
                    autoFocus
                    disabled={isDesktopBridgeTrade}
                    className={cn("uppercase placeholder:normal-case", isDesktopBridgeTrade && "cursor-not-allowed opacity-60")}
                />
            </div>
            <div className="col-span-2 md:col-span-1">
                <Select
                    isDarkMode={isDarkMode}
                    label="Asset Type"
                    icon={Target}
                    value={formData.assetType}
                    onChange={(val) => handleInputChange('assetType', val)}
                    disabled={isDesktopBridgeTrade}
                    options={[
                        { value: 'Forex', label: 'Forex' },
                        { value: 'Indices', label: 'Indices' },
                        { value: 'Commodities', label: 'Commodities (Gold/Oil)' },
                        { value: 'Crypto', label: 'Crypto' },
                        { value: 'Stocks', label: 'Stocks' },
                    ]}
                />
            </div>
            <div className="col-span-2 md:col-span-1">
                <Select
                    isDarkMode={isDarkMode}
                    label="Trading Session"
                    icon={Clock}
                    value={formData.session}
                    onChange={(val) => handleInputChange('session', val)}
                    options={[
                        { value: 'New York Session', label: 'New York Session' },
                        { value: 'London Session', label: 'London Session' },
                        { value: 'Tokyo Session', label: 'Tokyo Session' },
                        { value: 'Sydney Session', label: 'Sydney Session' },
                    ]}
                />
            </div>

            <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4">
                    <Input
                        label="Entry Date"
                        leftIcon={<Calendar size={16} />}
                        type="date"
                        value={formData.date}
                        onChange={(e) => handleInputChange('date', e.target.value)}
                        disabled={isDesktopBridgeTrade}
                        isDarkMode={isDarkMode}
                    />
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                            Setup Quality Rating
                        </label>
                        <StarRating
                            rating={formData.rating}
                            onChange={(val) => handleInputChange('rating', val)}
                            isDarkMode={isDarkMode}
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <Input
                        label="Entry Time"
                        leftIcon={<Clock size={16} />}
                        type="time"
                        value={formData.time}
                        onChange={(e) => handleInputChange('time', e.target.value)}
                        disabled={isDesktopBridgeTrade}
                        isDarkMode={isDarkMode}
                    />
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Voice Note</label>
                            <FeatureGate feature="voiceNotes" userProfile={userProfile} variant="inline"><span></span></FeatureGate>
                        </div>
                        <FeatureGate
                            feature="voiceNotes"
                            userProfile={userProfile}
                            fallback={
                                <div className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                                    Voice notes are available on Premium.
                                </div>
                            }
                        >
                            <div
                                className={cn(
                                    "rounded-xl p-3 transition-colors",
                                    isRecordingVoiceNote
                                        ? "bg-rose-500/5"
                                        : isDarkMode
                                            ? "bg-black/30"
                                            : "bg-slate-50/60"
                                )}
                            >
                                {isRecordingVoiceNote ? (
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={toggleVoiceNoteRecording}
                                            aria-label="Stop recording"
                                            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white transition-transform hover:scale-105 active:scale-95"
                                        >
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-40"></span>
                                            <Square size={13} fill="currentColor" />
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-black text-rose-500 tabular-nums">{formatDuration(recordingSeconds)}</span>
                                                <span className={cn("text-[9px] font-bold uppercase tracking-widest", isDarkMode ? 'text-zinc-600' : 'text-slate-400')}>
                                                    / {formatDuration(MAX_VOICE_NOTE_SECONDS)} max
                                                </span>
                                            </div>
                                            <div className="mt-1.5 flex h-4 items-center gap-[3px]">
                                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((bar) => (
                                                    <span
                                                        key={bar}
                                                        className="w-[3px] rounded-full bg-rose-500/80 animate-pulse"
                                                        style={{ height: `${6 + ((bar * 5) % 11)}px`, animationDelay: `${bar * 90}ms`, animationDuration: '700ms' }}
                                                    ></span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : isAudioVoiceNote ? (
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                                            <Mic size={15} />
                                        </div>
                                        <AudioNote
                                            src={formData.voiceNote}
                                            className="w-full min-w-0 h-9"
                                            onError={() => setVoiceNoteError('Could not play the recording. Try recording again.')}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleInputChange('voiceNote', '');
                                                setVoiceNoteError(null);
                                            }}
                                            aria-label="Delete voice note"
                                            className={cn(
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                                                isDarkMode
                                                    ? "border-zinc-800 text-zinc-500 hover:border-rose-500/40 hover:text-rose-400"
                                                    : "border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-500"
                                            )}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                ) : formData.voiceNote ? (
                                    <div className="flex items-start gap-2">
                                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", isDarkMode ? "bg-zinc-800/60 text-zinc-400" : "bg-slate-200/60 text-slate-500")}>
                                            <Mic size={15} />
                                        </div>
                                        <p className={cn("min-w-0 flex-1 text-[11px] leading-relaxed whitespace-pre-wrap", isDarkMode ? 'text-zinc-400' : 'text-slate-600')}>
                                            {formData.voiceNote}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleInputChange('voiceNote', '');
                                                setVoiceNoteError(null);
                                            }}
                                            aria-label="Delete voice note"
                                            className={cn(
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                                                isDarkMode
                                                    ? "border-zinc-800 text-zinc-500 hover:border-rose-500/40 hover:text-rose-400"
                                                    : "border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-500"
                                            )}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={toggleVoiceNoteRecording}
                                        className={cn(
                                            "group flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-left transition-colors",
                                            isDarkMode ? "hover:bg-white/[0.03]" : "hover:bg-slate-100/60"
                                        )}
                                    >
                                        <span className={cn(
                                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all group-hover:scale-105 group-active:scale-95",
                                            isDarkMode
                                                ? "bg-zinc-800 text-zinc-300 group-hover:bg-zinc-700 group-hover:text-white"
                                                : "bg-slate-200 text-slate-600 group-hover:bg-slate-300 group-hover:text-slate-900"
                                        )}>
                                            <Mic size={16} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className={cn("block text-xs font-bold", isDarkMode ? "text-zinc-300" : "text-slate-700")}>
                                                Record a voice note
                                            </span>
                                            <span className={cn("block text-[10px] font-medium", isDarkMode ? "text-zinc-600" : "text-slate-400")}>
                                                Tap the mic and speak — up to {formatDuration(MAX_VOICE_NOTE_SECONDS)}
                                            </span>
                                        </span>
                                    </button>
                                )}
                                {voiceNoteError && <p className="mt-2 text-xs font-medium text-rose-500">{voiceNoteError}</p>}
                            </div>
                        </FeatureGate>
                    </div>
                </div>
            </div>

            <div className="col-span-2">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Entry Comment
                </label>
                <div className="relative">
                    <RichTextEditor
                        isDarkMode={isDarkMode}
                        placeholder="Describe your rationale for entering the trade..."
                        content={formData.notes}
                        onChange={(val) => handleInputChange('notes', val)}
                        minHeight="150px"
                    />
                </div>
            </div>
        </div>
    );
};
