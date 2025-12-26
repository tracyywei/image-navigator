export interface RotorItem {
  id: string;
  label: string;
  description: string;
  regionHint?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  children?: RotorItem[];
}

export interface ImageData {
  id: string;
  src: string;
  altText: string;
  imageText: string[];
  lenses: {
    objects: RotorItem[];
    layout: RotorItem[];
    style: RotorItem[];
  };
}

export const demoImage: ImageData = {
  id: "islamic-gallery",
  src: "https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?w=1200&q=80",
  altText: "Interior of an art gallery displaying Islamic art, featuring decorative rugs on the floor, illuminated display cases along the walls, and natural light from distant windows.",
  imageText: ["Art of the Islamic Worlds"],
  lenses: {
    objects: [
      {
        id: "rugs",
        label: "Large decorative rugs",
        description: "Large patterned rug covers the center of the gallery floor, featuring dense symmetrical motifs in dark red and blue tones with intricate border designs typical of Persian or Central Asian weaving traditions.",
        regionHint: { x: 20, y: 60, width: 60, height: 35 },
        children: [
          {
            id: "rug-pattern",
            label: "Geometric patterns",
            description: "Repeating medallion and arabesque patterns with a central focal point, using traditional color palette of crimson, navy, and ivory.",
            regionHint: { x: 30, y: 65, width: 40, height: 25 }
          }
        ]
      },
      {
        id: "display-cases",
        label: "Illuminated display cases",
        description: "Glass-fronted display cases line the walls, internally lit to highlight ceramic vessels, metalwork, and small sculptural objects. Each case presents artifacts at viewing height with subtle spotlighting.",
        regionHint: { x: 5, y: 20, width: 25, height: 50 }
      },
      {
        id: "vessels",
        label: "Ceramic vessels",
        description: "Collection of blue and white ceramic vessels visible in the display cases, including large vases with cobalt decorations and smaller bowls with calligraphic elements.",
        regionHint: { x: 8, y: 30, width: 15, height: 30 }
      },
      {
        id: "wall-text",
        label: "Gallery title text",
        description: "Large text reading 'Art of the Islamic Worlds' mounted on the wall, identifying the gallery's thematic focus.",
        regionHint: { x: 55, y: 15, width: 35, height: 10 }
      },
      {
        id: "benches",
        label: "Visitor seating",
        description: "Low upholstered benches positioned in the gallery center, providing rest points for visitors while maintaining sightlines to surrounding displays.",
        regionHint: { x: 40, y: 55, width: 20, height: 15 }
      }
    ],
    layout: [
      {
        id: "center-floor",
        label: "Central floor area",
        description: "Open floor space dominates the gallery center, covered by the large decorative rug. This creates a unified visual anchor and defines the primary circulation path around the perimeter.",
        regionHint: { x: 15, y: 50, width: 70, height: 45 }
      },
      {
        id: "wall-displays",
        label: "Perimeter wall displays",
        description: "Display cases and mounted objects arranged along all visible walls, creating a continuous gallery experience as visitors move around the central space.",
        regionHint: { x: 0, y: 10, width: 100, height: 55 }
      },
      {
        id: "circulation",
        label: "Visitor circulation path",
        description: "Clear walking path between the central rug and wall displays allows visitors to move through the gallery while viewing objects from multiple angles.",
        regionHint: { x: 5, y: 45, width: 90, height: 20 }
      },
      {
        id: "windows",
        label: "Far windows",
        description: "Large arched windows visible at the far end of the gallery provide natural daylight and create visual depth, drawing the eye toward the back of the space.",
        regionHint: { x: 70, y: 5, width: 25, height: 40 }
      },
      {
        id: "ceiling",
        label: "Gallery ceiling",
        description: "High ceiling with track lighting visible above, combining natural and artificial light sources to illuminate the gallery evenly.",
        regionHint: { x: 20, y: 0, width: 60, height: 15 }
      }
    ],
    style: [
      {
        id: "brightness",
        label: "Overall brightness",
        description: "Moderately lit gallery space with warm ambient lighting. Natural light from windows mixes with directed spotlights on display cases, creating gentle contrasts without harsh shadows.",
      },
      {
        id: "color-palette",
        label: "Color palette",
        description: "Dominant colors are the rich reds and blues of the central rug against neutral wall tones. Display lighting adds warm highlights, while the overall atmosphere remains calm and subdued.",
      },
      {
        id: "visual-order",
        label: "Visual order and symmetry",
        description: "Strong sense of order with bilateral symmetry. The central rug anchors the composition, with balanced arrangements of cases and objects on either side.",
      },
      {
        id: "contrast",
        label: "Light and shadow contrast",
        description: "Moderate contrast between lit display cases and ambient gallery lighting. The illuminated objects stand out against darker backgrounds, guiding visual attention.",
      },
      {
        id: "density",
        label: "Visual density",
        description: "Medium density of objects and visual information. The open floor provides breathing room while walls are richly populated with displays, creating a balanced viewing experience.",
      }
    ]
  }
};

export type LensType = "objects" | "layout" | "style";

export const lensLabels: Record<LensType, string> = {
  objects: "Objects",
  layout: "Layout",
  style: "Style"
};

export const lensDescriptions: Record<LensType, string> = {
  objects: "Physical things in the image",
  layout: "Spatial organization and arrangement",
  style: "Visual qualities and atmosphere"
};
