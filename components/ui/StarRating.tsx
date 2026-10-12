import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '../../lib/utils';

interface StarRatingProps {
    rating: number;
    onChange: (val: number) => void;
    isDarkMode: boolean;
}

export const StarRating: React.FC<StarRatingProps> = ({ rating, onChange, isDarkMode }) => {
    const [hovered, setHovered] = useState<number | null>(null);

    const labels: { [key: number]: string } = {
        1: "Poor Setup",
        2: "Weak Setup",
        3: "Average Setup",
        4: "Good Setup",
        5: "A+ Setup"
    };

    const currentDisplay = hovered || rating;

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                    <button
                        key={star}
                        type="button"
                        onClick={() => onChange(star)}
                        onMouseEnter={() => setHovered(star)}
                        onMouseLeave={() => setHovered(null)}
                        className={cn(
                            "transition-all duration-200 transform hover:scale-110 active:scale-90",
                            star <= (hovered || rating)
                                ? 'text-amber-400 fill-amber-400'
                                : isDarkMode ? 'text-zinc-700 hover:text-zinc-500' : 'text-slate-200 hover:text-slate-300'
                        )}
                        aria-label={`Rate ${star} stars: ${labels[star]}`}
                    >
                        <Star size={18} strokeWidth={star <= (hovered || rating) ? 1 : 2} />
                    </button>
                ))}
            </div>
            <span className={cn(
                "text-xs font-bold transition-opacity duration-200",
                currentDisplay > 0 ? 'opacity-100' : 'opacity-0',
                currentDisplay >= 4 ? 'text-teal-500' : currentDisplay >= 3 ? 'text-amber-500' : 'text-rose-500'
            )}>
                {labels[currentDisplay]}
            </span>
        </div>
    );
};
