// Inline stroke icons (24px grid, currentColor). Kept local to avoid an icon dependency.

type Props = { size?: number; className?: string };

function Svg({ size = 16, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const Logo = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
  </Svg>
);
export const Upload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 15V4m0 0L8 8m4-4l4 4" />
    <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
  </Svg>
);
export const ArrowLeft = (p: Props) => (
  <Svg {...p}>
    <path d="M19 12H5m6-6l-6 6 6 6" />
  </Svg>
);
export const ArrowRight = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12h14m-6-6l6 6-6 6" />
  </Svg>
);
export const External = (p: Props) => (
  <Svg {...p}>
    <path d="M14 5h5v5M19 5l-8 8" />
    <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
  </Svg>
);
export const Share = (p: Props) => (
  <Svg {...p}>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M8.3 13.3l7.4 4.3M15.7 6.4l-7.4 4.3" />
  </Svg>
);
export const Download = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v11m0 0l-4-4m4 4l4-4" />
    <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
  </Svg>
);
export const Globe = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
  </Svg>
);
export const Eye = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const Road = (p: Props) => (
  <Svg {...p}>
    <path d="M8 3L4 21M16 3l4 18M12 4v3m0 4v3m0 4v2" />
  </Svg>
);
export const Shield = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Svg>
);
export const Satellite = (p: Props) => (
  <Svg {...p}>
    <path d="M13 7l4 4-6 6-4-4 6-6z" />
    <path d="M6.5 13.5L3 17m4 4l3.5-3.5M17 3l4 4-2 2-4-4 2-2z" />
  </Svg>
);
export const Photos = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="15" height="13" rx="2" />
    <path d="M21 8v11a2 2 0 01-2 2H7" />
    <path d="M3 15l4-4 4 4 2-2 5 5" />
  </Svg>
);
export const Zoom = (p: Props) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.8-4.8M10.5 8v5M8 10.5h5" />
  </Svg>
);
export const MapIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5 9 4z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Svg>
);
export const Search = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </Svg>
);
export const Spark = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
  </Svg>
);
export const Warn = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3l10 18H2L12 3z" />
    <path d="M12 10v4m0 3v.01" />
  </Svg>
);
export const Check = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);
export const Copy = (p: Props) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </Svg>
);
export const Lock = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 118 0v3" />
  </Svg>
);
export const Layers = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
);
export const Osm = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5 14l5-4 4 3 6-5" />
  </Svg>
);
