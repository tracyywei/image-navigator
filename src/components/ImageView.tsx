import { RotorItem } from '@/data/demoImage';

interface ImageViewProps {
  src: string;
  altText: string;
  selectedItem: RotorItem | null;
  isFocused: boolean;
}

export function ImageView({ src, altText, selectedItem, isFocused }: ImageViewProps) {
  const region = selectedItem?.regionHint;
  
  return (
    <div 
      className={`
        relative rounded-lg overflow-hidden bg-muted transition-all duration-200
        ${isFocused ? 'ring-[3px] ring-ring ring-offset-2 ring-offset-background' : 'ring-1 ring-border'}
      `}
      tabIndex={0}
      role="img"
      aria-label={altText}
    >
      {/* Image */}
      <img
        src={src}
        alt={altText}
        className="w-full h-auto object-cover"
        loading="eager"
      />
      
      {/* Region Overlay */}
      {region && (
        <div
          className="absolute region-overlay pointer-events-none"
          style={{
            left: `${region.x}%`,
            top: `${region.y}%`,
            width: `${region.width}%`,
            height: `${region.height}%`,
          }}
          aria-hidden="true"
        >
          {/* Outer glow */}
          <div 
            className="absolute inset-0 rounded-lg"
            style={{
              boxShadow: '0 0 0 3px hsl(var(--primary) / 0.8), 0 0 30px 10px hsl(var(--primary) / 0.3)',
              background: 'hsl(var(--primary) / 0.15)',
            }}
          />
          
          {/* Inner highlight */}
          <div 
            className="absolute inset-1 rounded-md border-2 border-dashed"
            style={{
              borderColor: 'hsl(var(--primary) / 0.5)',
            }}
          />
        </div>
      )}
      
      {/* Focus indicator badge */}
      {isFocused && (
        <div className="absolute top-3 left-3 px-2 py-1 bg-primary text-primary-foreground text-xs font-medium rounded">
          Image focused
        </div>
      )}
      
      {/* Selected item label */}
      {selectedItem && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-foreground/80 to-transparent p-4 pt-8">
          <span className="text-primary-foreground text-sm font-medium">
            {selectedItem.label}
          </span>
        </div>
      )}
    </div>
  );
}
