export const openaiService = {
  isConfigured(): boolean {
    return true; // Routed through server proxy
  },

  async transcribeAudio(
    audioBlob: Blob,
    options: {
      prompt?: string;
      language?: string;
      model?: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
    } = {}
  ): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('file', new File([audioBlob], 'audio.webm', { type: audioBlob.type }));
      formData.append('model', options.model || 'whisper-1');
      if (options.prompt) formData.append('prompt', options.prompt);
      if (options.language) formData.append('language', options.language);
      formData.append('response_format', 'text');

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Transcription failed: ${res.status} ${errText}`);
      }

      return await res.text();
    } catch (error: any) {
      console.error("Transcription Error:", error);
      throw error;
    }
  }
};
