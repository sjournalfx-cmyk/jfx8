import React, { useRef, useState } from 'react';
import { X, Save, TrendingUp, TrendingDown, Target, Clock, Hash, Layout } from 'lucide-react';
import { Trade, AssetType } from '../types';
import { Select } from './Select';
import { getSASTDateTime } from '../lib/timeUtils';
import { normalizeTrade } from '../lib/trade-normalization';

interface QuickLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (trade: Trade) => Promise<void>;
  isDarkMode: boolean;
  currencySymbol: string;
}

const QuickLogModal: React.FC<QuickLogModalProps> = ({ isOpen, onClose, onSave, isDarkMode, currencySymbol }) => {
  const [formData, setFormData] = useState({
    pair: '',
    assetType: 'Forex' as AssetType,
    direction: 'Long' as 'Long' | 'Short',
    entryPrice: '',
    stopLoss: '',
    takeProfit: '',
    lots: '1.00',
    result: 'Pending' as 'Win' | 'Loss' | 'BE' | 'Pending',
  });
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.pair || !formData.entryPrice) return;
    if (saveInFlightRef.current) return;

    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const sast = getSASTDateTime();
      const newTrade = normalizeTrade({
        id: crypto.randomUUID(),
        pair: formData.pair.toUpperCase(),
        assetType: formData.assetType,
        date: sast.date,
        time: sast.time,
        direction: formData.direction,
        entryPrice: parseFloat(formData.entryPrice),
        stopLoss: parseFloat(formData.stopLoss) || 0,
        takeProfit: parseFloat(formData.takeProfit) || 0,
        lots: parseFloat(formData.lots) || 0,
        result: formData.result,
        pnl: 0,
        rr: 0,
        rating: 0,
        tags: ['Quick Log'],
        notes: '',
        emotions: [],
        planAdherence: 'No Plan',
        tradingMistake: 'None',
        mindset: 'Neutral',
      }, {}, { preserveProvidedPnl: false });
      await onSave(newTrade);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 ${
          isDarkMode ? 'bg-[#000000] border-[#27272a] text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between p-6 border-b border-dashed border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#FF4F00]/10 text-[#FF4F00]">
              <Save size={20} />
            </div>
            <h2 className="text-xl font-bold tracking-tight">Quick Log Trade</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-500/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-1">
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-40">Pair</label>
              <input
                autoFocus
                required
                className={`w-full px-4 py-2.5 rounded-lg border outline-none text-sm font-bold uppercase transition-all ${
                  isDarkMode ? 'bg-black border-zinc-800 focus:border-[#FF4F00]' : 'bg-slate-50 border-slate-200 focus:border-[#FF4F00]'
                }`}
                placeholder="EURUSD"
                value={formData.pair}
                onChange={e => setFormData({ ...formData, pair: e.target.value })}
              />
            </div>
            <div className="col-span-1">
              <Select
                label="Type"
                isDarkMode={isDarkMode}
                value={formData.assetType}
                onChange={val => setFormData({ ...formData, assetType: val as any })}
                options={[
                  { value: 'Forex', label: 'Forex' },
                  { value: 'Indices', label: 'Indices' },
                  { value: 'Commodities', label: 'Commodities' },
                  { value: 'Crypto', label: 'Crypto' },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-40">Direction</label>
              <div className={`p-1 rounded-xl flex border ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, direction: 'Long' })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    formData.direction === 'Long' ? 'bg-teal-500 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <TrendingUp size={14} /> Long
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, direction: 'Short' })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    formData.direction === 'Short' ? 'bg-rose-500 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <TrendingDown size={14} /> Short
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-40">Entry</label>
              <input
                required
                type="number"
                step="any"
                className={`w-full px-4 py-2.5 rounded-lg border outline-none text-sm font-mono ${
                  isDarkMode ? 'bg-black border-zinc-800 focus:border-[#FF4F00]' : 'bg-slate-50 border-slate-200 focus:border-[#FF4F00]'
                }`}
                placeholder="1.08500"
                value={formData.entryPrice}
                onChange={e => setFormData({ ...formData, entryPrice: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-40">Lots</label>
              <input
                type="number"
                step="0.01"
                className={`w-full px-4 py-2.5 rounded-lg border outline-none text-sm font-mono ${
                  isDarkMode ? 'bg-black border-zinc-800 focus:border-[#FF4F00]' : 'bg-slate-50 border-slate-200 focus:border-[#FF4F00]'
                }`}
                placeholder="1.00"
                value={formData.lots}
                onChange={e => setFormData({ ...formData, lots: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-40 text-rose-500">Stop Loss</label>
              <input
                type="number"
                step="any"
                className={`w-full px-4 py-2.5 rounded-lg border outline-none text-sm font-mono ${
                  isDarkMode ? 'bg-black border-zinc-800 focus:border-rose-500' : 'bg-slate-50 border-slate-200 focus:border-rose-500'
                }`}
                placeholder="0.00000"
                value={formData.stopLoss}
                onChange={e => setFormData({ ...formData, stopLoss: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 opacity-40 text-teal-500">Take Profit</label>
              <input
                type="number"
                step="any"
                className={`w-full px-4 py-2.5 rounded-lg border outline-none text-sm font-mono ${
                  isDarkMode ? 'bg-black border-zinc-800 focus:border-teal-500' : 'bg-slate-50 border-slate-200 focus:border-teal-500'
                }`}
                placeholder="0.00000"
                value={formData.takeProfit}
                onChange={e => setFormData({ ...formData, takeProfit: e.target.value })}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-4 bg-[#FF4F00] hover:bg-[#E64600] text-white rounded-xl font-bold text-sm shadow-xl shadow-[#FF4F00]/20 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
            {isSaving ? 'Saving...' : 'Save Quick Trade'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default QuickLogModal;
