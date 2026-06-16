import { useState } from 'react';
import { MT5_BRIDGE_URL } from '../lib/constants';

export const useMT5Bridge = (initialSymbol: string, initialTimeframe: string) => {
    const [symbol, setSymbol] = useState(initialSymbol);
    const [timeframe, setTimeframe] = useState(initialTimeframe);
    const [isFetching, setIsFetching] = useState(false);
    const [allData, setAllData] = useState<any[]>([]);
    const [currentIndex, setCurrentIdx] = useState(0);

    const fetchData = async (overrideSymbol?: string, overrideTimeframe?: string) => {
        setIsFetching(true);
        const activeSymbol = overrideSymbol || symbol;
        const activeTF = overrideTimeframe || timeframe;
        try {
            const response = await fetch(`${MT5_BRIDGE_URL}/data?symbol=${activeSymbol}&tf=${activeTF}&count=1000`).catch(() => {
                throw new Error('MT5 Bridge disconnected. Please launch and start the JournalFX Bridge app.');
            });
            if (!response.ok) throw new Error('Bridge returned an error. Ensure MT5 is open.');
            
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (!Array.isArray(data) || data.length === 0) throw new Error('Invalid data format');

            setAllData(data);
            const startIdx = Math.min(50, data.length - 1);
            setCurrentIdx(startIdx);
            
            return { data, startIdx };
        } catch (err: any) {
            throw err;
        } finally {
            setIsFetching(false);
        }
    };

    return {
        symbol,
        setSymbol,
        timeframe,
        setTimeframe,
        isFetching,
        allData,
        setAllData,
        currentIndex,
        setCurrentIdx,
        fetchData
    };
};
