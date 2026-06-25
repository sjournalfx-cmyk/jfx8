import React, { useEffect, useRef, useState } from 'react';
import { Layout, Target, Clock, Calendar, Mic } from 'lucide-react';
import { AssetType } from '../../types';
import { Select } from '../Select';
import { Input } from '../ui/Input';
import { StarRating } from '../ui/StarRating';
import RichTextEditor from '../RichTextEditor';
import { FeatureGate } from '../ui/FeatureGate';
import { cn } from '../../lib/utils';
import { browserSpeechService } from '../../services/voiceInputService';

interface TradeFormStep1Props {
    formData: any;
    handleInputChange: (field: string, value: any) => void;
    pairError: string | null;
    isDarkMode: boolean;
    userProfile: any;
    isDesktopBridgeTrade?: boolean;
}

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
    const voiceNoteRecognitionRef = useRef<ReturnType<typeof browserSpeechService.createRecognition> | null>(null);
    const voiceNoteBaseRef = useRef('');
    const voiceNoteFinalRef = useRef('');
    const voiceNoteInterimRef = useRef('');

    useEffect(() => {
        return () => {
            try {
                voiceNoteRecognitionRef.current?.abort();
            } catch {}
            voiceNoteRecognitionRef.current = null;
            voiceNoteFinalRef.current = '';
            voiceNoteInterimRef.current = '';
        };
    }, []);

    const stopVoiceNoteRecording = () => {
        try {
            voiceNoteRecognitionRef.current?.stop();
        } catch {}
        voiceNoteRecognitionRef.current = null;
        setIsRecordingVoiceNote(false);
    };

    const toggleVoiceNoteRecording = () => {
        if (isRecordingVoiceNote) {
            stopVoiceNoteRecording();
            return;
        }

        if (!browserSpeechService.isSupported()) {
            setVoiceNoteError('Voice recording is not supported in this browser.');
            return;
        }

        setVoiceNoteError(null);
        voiceNoteBaseRef.current = formData.voiceNote || '';
        voiceNoteFinalRef.current = '';
        voiceNoteInterimRef.current = '';

        const recognition = browserSpeechService.createRecognition(
            ({ finalTranscript, interimTranscript }) => {
                if (finalTranscript) {
                    voiceNoteFinalRef.current = [voiceNoteFinalRef.current, finalTranscript.trim()].filter(Boolean).join(' ').trim();
                }
                voiceNoteInterimRef.current = interimTranscript.trim();
                const transcript = [voiceNoteBaseRef.current.trim(), voiceNoteFinalRef.current.trim(), voiceNoteInterimRef.current.trim()]
                    .filter(Boolean)
                    .join(' ')
                    .trim();
                handleInputChange('voiceNote', transcript);
            },
            (error) => {
                if (!['aborted', 'no-speech'].includes(error)) {
                    setVoiceNoteError('Voice recording stopped unexpectedly. Try again.');
                }
            },
            () => {
                setIsRecordingVoiceNote(false);
                voiceNoteRecognitionRef.current = null;
                voiceNoteInterimRef.current = '';
            }
        );

        if (!recognition) {
            setVoiceNoteError('Voice recording is not supported in this browser.');
            return;
        }

        voiceNoteRecognitionRef.current = recognition;
        setIsRecordingVoiceNote(true);

        try {
            recognition.start();
        } catch {
            setIsRecordingVoiceNote(false);
            setVoiceNoteError('Could not start voice recording.');
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
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={toggleVoiceNoteRecording}
                                    className={cn(
                                        "inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all",
                                        isRecordingVoiceNote
                                            ? "bg-rose-500 text-white"
                                            : isDarkMode
                                                ? "bg-black text-zinc-200 hover:bg-black border border-zinc-700"
                                                : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                                    )}
                                >
                                    <Mic size={14} />
                                    {isRecordingVoiceNote ? 'Stop' : 'Record'}
                                </button>
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${isRecordingVoiceNote ? 'text-emerald-500' : isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                                    {isRecordingVoiceNote ? 'Listening' : null}
                                </span>
                                {voiceNoteError && <p className="w-full text-xs font-medium text-rose-500">{voiceNoteError}</p>}
                            </div>
                        </FeatureGate>
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
