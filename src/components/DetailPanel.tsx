import { Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RotorItem } from '@/data/demoImage';

interface DetailPanelProps {
  item: RotorItem | null;
  onSpeak: (text: string) => void;
  onClose: () => void;
  isSpeaking: boolean;
}

export function DetailPanel({ item, onSpeak, onClose, isSpeaking }: DetailPanelProps) {
  if (!item) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-muted-foreground text-sm">
            Select an item from the rotor to see its detailed description.
          </p>
          <p className="text-muted-foreground text-xs mt-2">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">R</kbd> to open the rotor, then use arrow keys to navigate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-border">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="font-semibold text-foreground text-lg">
            {item.label}
          </h3>
          {item.regionHint && (
            <span className="text-xs text-muted-foreground mt-1 inline-block">
              Region: {item.regionHint.x < 33 ? 'left' : item.regionHint.x > 66 ? 'right' : 'center'} 
              {' '}
              {item.regionHint.y < 33 ? 'top' : item.regionHint.y > 66 ? 'bottom' : 'middle'}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSpeak(item.description)}
            aria-label="Read description aloud"
            className={`h-8 w-8 focus-ring ${isSpeaking ? 'text-speaking' : ''}`}
          >
            <Volume2 className={`h-4 w-4 ${isSpeaking ? 'speaking-pulse' : ''}`} />
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close detail panel"
            className="h-8 w-8 focus-ring"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Description */}
      <div className="flex-1 p-4 overflow-y-auto">
        <p className="text-foreground leading-relaxed">
          {item.description}
        </p>
      </div>
      
      {/* Children preview */}
      {item.children && item.children.length > 0 && (
        <div className="p-4 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
            Related details
          </p>
          <ul className="space-y-1">
            {item.children.map((child) => (
              <li 
                key={child.id}
                className="text-sm text-foreground/80 pl-3 border-l-2 border-border"
              >
                {child.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
