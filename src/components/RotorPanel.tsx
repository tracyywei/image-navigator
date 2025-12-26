import { ChevronLeft, ChevronRight, Eye, Layout, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LensType, RotorItem, lensLabels, lensDescriptions } from '@/data/demoImage';

interface RotorPanelProps {
  currentLens: LensType;
  items: RotorItem[];
  focusedIndex: number;
  selectedItem: RotorItem | null;
  isRotorFocused: boolean;
  onLensChange: (direction: 'left' | 'right') => void;
  onItemSelect: (item: RotorItem) => void;
  onItemFocus: (index: number) => void;
}

const lensIcons: Record<LensType, React.ReactNode> = {
  objects: <Eye className="h-4 w-4" />,
  layout: <Layout className="h-4 w-4" />,
  style: <Palette className="h-4 w-4" />
};

const lensOrder: LensType[] = ['objects', 'layout', 'style'];

export function RotorPanel({
  currentLens,
  items,
  focusedIndex,
  selectedItem,
  isRotorFocused,
  onLensChange,
  onItemSelect,
  onItemFocus
}: RotorPanelProps) {
  return (
    <div 
      className={`
        flex flex-col h-full bg-rotor-bg rounded-lg border transition-all duration-200
        ${isRotorFocused ? 'border-primary ring-2 ring-primary/20' : 'border-border'}
      `}
      role="region"
      aria-label="Image rotor navigation"
    >
      {/* Lens Selector */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onLensChange('left')}
          aria-label="Previous lens"
          className="h-8 w-8 focus-ring"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className={`transition-colors ${isRotorFocused ? 'text-primary' : 'text-muted-foreground'}`}>
              {lensIcons[currentLens]}
            </span>
            <h2 className="font-semibold text-foreground">
              {lensLabels[currentLens]}
            </h2>
          </div>
          <span className="text-xs text-muted-foreground mt-0.5">
            {lensDescriptions[currentLens]}
          </span>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onLensChange('right')}
          aria-label="Next lens"
          className="h-8 w-8 focus-ring"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Lens Indicators */}
      <div className="flex justify-center gap-2 py-2 border-b border-border">
        {lensOrder.map((lens) => (
          <div
            key={lens}
            className={`
              h-1.5 w-8 rounded-full transition-colors duration-200
              ${lens === currentLens ? 'bg-primary' : 'bg-border'}
            `}
            aria-hidden="true"
          />
        ))}
      </div>
      
      {/* Items List */}
      <div 
        className="flex-1 overflow-y-auto rotor-scroll"
        role="listbox"
        aria-label={`${lensLabels[currentLens]} items`}
        aria-activedescendant={items[focusedIndex]?.id}
      >
        <ul className="p-2 space-y-1">
          {items.map((item, index) => {
            const isFocused = index === focusedIndex && isRotorFocused;
            const isSelected = selectedItem?.id === item.id;
            
            return (
              <li key={item.id}>
                <button
                  id={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onItemFocus(index);
                    onItemSelect(item);
                  }}
                  onFocus={() => onItemFocus(index)}
                  className={`
                    w-full text-left px-3 py-2.5 rounded-md transition-all duration-150
                    focus-ring
                    ${isFocused ? 'bg-rotor-item-active border-l-[3px] border-rotor-item-active-border' : ''}
                    ${isSelected && !isFocused ? 'bg-rotor-item-active/50 border-l-[3px] border-rotor-item-active-border/50' : ''}
                    ${!isFocused && !isSelected ? 'hover:bg-rotor-item-hover border-l-[3px] border-transparent' : ''}
                  `}
                >
                  <span className={`
                    block text-sm font-medium
                    ${isFocused || isSelected ? 'text-foreground' : 'text-foreground/80'}
                  `}>
                    {item.label}
                  </span>
                  {item.children && item.children.length > 0 && (
                    <span className="text-xs text-muted-foreground mt-0.5 block">
                      +{item.children.length} sub-items
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      
      {/* Item Count */}
      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground text-center">
        {items.length} {items.length === 1 ? 'item' : 'items'} in {lensLabels[currentLens].toLowerCase()}
      </div>
    </div>
  );
}
